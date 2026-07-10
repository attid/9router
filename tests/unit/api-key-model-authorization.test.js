import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiKeyByValue: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyByValue: mocks.getApiKeyByValue,
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

const { authorizeModelRequest, extractApiKey } = await import("../../src/sse/services/auth.js");
const repoRoot = path.resolve(import.meta.dirname, "../..");

function request(apiKey, url = "https://9router.local/v1/chat/completions") {
  return new Request(url, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
}

describe("central API-key model authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows an exact request-facing model alias without resolving it", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({
      key: "sk-restricted",
      isActive: true,
      allowedModels: ["fast-model"],
    });

    const result = await authorizeModelRequest(request("sk-restricted"), {
      model: "fast-model",
      settings: { requireApiKey: true },
    });

    expect(result.response).toBeNull();
    expect(result.apiKey).toBe("sk-restricted");
    expect(mocks.getApiKeyByValue).toHaveBeenCalledWith("sk-restricted");
  });

  it("rejects a disallowed request-facing model", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({
      key: "sk-restricted",
      isActive: true,
      allowedModels: ["fast-model"],
    });

    const result = await authorizeModelRequest(request("sk-restricted"), {
      model: "provider/blocked-model",
      settings: { requireApiKey: true },
    });

    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toMatchObject({
      error: { message: 'Model "provider/blocked-model" is not allowed for this API key' },
    });
  });

  it("rejects inactive keys when authentication is required", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({ key: "sk-paused", isActive: false });

    const result = await authorizeModelRequest(request("sk-paused"), {
      model: "fast-model",
      settings: { requireApiKey: true },
    });

    expect(result.response.status).toBe(401);
  });

  it("recognizes Gemini request authentication forms", () => {
    expect(extractApiKey(new Request("https://9router.local/v1beta/models/x", {
      headers: { "x-goog-api-key": "sk-google-header" },
    }))).toBe("sk-google-header");
    expect(extractApiKey(new Request(
      "https://9router.local/v1beta/models/x?key=sk-google-query"
    ))).toBe("sk-google-query");
  });
});

const MODEL_HANDLERS = [
  ["src/sse/handlers/chat.js", "modelStr", "getComboModels("],
  ["src/sse/handlers/embeddings.js", "modelStr", "getModelInfo("],
  ["src/sse/handlers/imageGeneration.js", "modelStr", "getComboModels("],
  ["src/sse/handlers/tts.js", "modelStr", "getComboModels("],
  ["src/sse/handlers/stt.js", "modelStr", "getModelInfo("],
  ["src/sse/handlers/search.js", "providerInput", "getCombos("],
  ["src/sse/handlers/fetch.js", "providerInput", "getCombos("],
];

describe("model-bearing endpoint coverage", () => {
  it.each(MODEL_HANDLERS)("%s delegates authorization centrally before routing", (filename, modelVariable, routingCall) => {
    const source = fs.readFileSync(path.resolve(repoRoot, filename), "utf8");
    expect(source).toContain("authorizeModelRequest");
    expect(source).toContain(`model: ${modelVariable}`);
    const handlerStart = source.indexOf("export async function handle");
    const handlerEnd = source.indexOf("\nasync function", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd > 0 ? handlerEnd : undefined);
    expect(handler.indexOf("await authorizeModelRequest")).toBeGreaterThanOrEqual(0);
    expect(handler.indexOf("await authorizeModelRequest")).toBeLessThan(handler.indexOf(routingCall));
  });

  it.each([
    "src/app/api/v1/chat/completions/route.js",
    "src/app/api/v1/messages/route.js",
    "src/app/api/v1/responses/route.js",
    "src/app/api/v1/responses/compact/route.js",
    "src/app/api/v1/api/chat/route.js",
  ])("%s routes through the centrally authorized chat handler", (filename) => {
    const source = fs.readFileSync(path.resolve(repoRoot, filename), "utf8");
    expect(source).toContain("handleChat(");
  });

  it("covers the native Gemini media route before credential lookup", () => {
    const source = fs.readFileSync(
      path.resolve(repoRoot, "src/app/api/v1beta/models/[...path]/route.js"),
      "utf8"
    );
    const handler = source.slice(source.indexOf("async function forwardGeminiNativeRequest"));
    expect(handler).toContain("authorizeModelRequest");
    expect(handler.indexOf("authorizeModelRequest")).toBeLessThan(handler.indexOf("getProviderCredentials"));
  });
});
