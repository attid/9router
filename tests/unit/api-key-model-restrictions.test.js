import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  authorizeModelRequest: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: (request) => request.headers.get("authorization")?.replace(/^Bearer /, "") || null,
  authorizeModelRequest: mocks.authorizeModelRequest,
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: vi.fn() }));
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: mocks.handleComboChat,
  handleFusionChat: mocks.handleFusionChat,
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function chatRequest(model, apiKey = "sk-restricted") {
  return new Request("https://9router.local/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Hello" }] }),
  });
}

describe("API-key model enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: true, comboStrategy: "fallback" });
    mocks.authorizeModelRequest.mockResolvedValue({ apiKey: "sk-restricted", response: null });
    mocks.getComboModels.mockResolvedValue(["openai/gpt-5"]);
    mocks.handleComboChat.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("rejects a disallowed requested model before combo or provider routing", async () => {
    mocks.authorizeModelRequest.mockResolvedValue({
      apiKey: "sk-restricted",
      response: new Response(JSON.stringify({
        error: { message: 'Model "blocked-combo" is not allowed for this API key' },
      }), { status: 403, headers: { "content-type": "application/json" } }),
    });

    const response = await handleChat(chatRequest("blocked-combo"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { message: 'Model "blocked-combo" is not allowed for this API key' },
    });
    expect(mocks.getComboModels).not.toHaveBeenCalled();
    expect(mocks.getModelInfo).not.toHaveBeenCalled();
  });

  it("routes an explicitly allowed requested model", async () => {
    const response = await handleChat(chatRequest("allowed-combo"));

    expect(response.status).toBe(200);
    expect(mocks.getComboModels).toHaveBeenCalledWith("allowed-combo");
    expect(mocks.handleComboChat).toHaveBeenCalledOnce();
  });

  it.each([null, []])("routes a model when the key allowlist is %j", async (allowedModels) => {
    const response = await handleChat(chatRequest("any-combo", "sk-unrestricted"));

    expect(response.status).toBe(200);
    expect(mocks.handleComboChat).toHaveBeenCalledOnce();
  });
});
