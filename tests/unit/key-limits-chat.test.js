import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getComboByName: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  checkKeyLimits: vi.fn(),
  handleChatCore: vi.fn(),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, getComboByName: mocks.getComboByName }));
vi.mock("@/sse/services/keyLimits.js", () => ({ checkKeyLimits: mocks.checkKeyLimits }));
vi.mock("@/sse/services/model.js", () => ({ getComboModels: mocks.getComboModels, getModelInfo: mocks.getModelInfo }));
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: () => "sk-chat-test",
  isValidApiKey: vi.fn().mockResolvedValue(true),
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: mocks.handleComboChat,
  handleFusionChat: mocks.handleFusionChat,
}));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: vi.fn() }));
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => new Response(JSON.stringify({ error: { message } }), { status }),
  unavailableResponse: vi.fn(),
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: () => null }));
vi.mock("open-sse/config/runtimeConfig.js", () => ({
  HTTP_STATUS: { BAD_REQUEST: 400, UNAUTHORIZED: 401, NOT_FOUND: 404, RATE_LIMITED: 429, SERVICE_UNAVAILABLE: 503 },
}));
vi.mock("open-sse/translator/formats.js", () => ({ detectFormatByEndpoint: vi.fn() }));
vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn(), maskKey: () => "sk-chat***",
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));

import { handleChat } from "@/sse/handlers/chat.js";

function requestFor(model) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-chat-test" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hello" }] }),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false, comboStrategy: "fallback" });
  mocks.getComboByName.mockResolvedValue(null);
  mocks.getComboModels.mockResolvedValue(null);
  mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-test" });
  mocks.getProviderCredentials.mockResolvedValue({
    connectionId: "connection-1",
    connectionName: "test",
    apiKey: "provider-key",
  });
  mocks.checkKeyLimits.mockResolvedValue({ allowed: true });
  mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok") });
  mocks.handleComboChat.mockImplementation(({ handleSingleModel, models }) => handleSingleModel({ model: models[0] }, models[0]));
  mocks.handleFusionChat.mockImplementation(({ handleSingleModel, models }) => handleSingleModel({ model: models[0] }, models[0], true));
});

describe("chat token-limit enforcement", () => {
  it("propagates one immutable admission timestamp to the usage pipeline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T05:30:00.000Z"));

    await handleChat(requestFor("openai/gpt-test"));

    const usageMeta = mocks.handleChatCore.mock.calls[0][0].clientRawRequest.usageMeta;
    expect(usageMeta.startedAt).toBe("2026-11-01T05:30:00.000Z");
    expect(Object.isFrozen(usageMeta)).toBe(true);
    vi.useRealTimers();
  });

  it("returns a structured 429 and Retry-After before model routing", async () => {
    mocks.checkKeyLimits.mockResolvedValue({ allowed: false, error: "hourly exhausted", retryAfter: 42 });

    const response = await handleChat(requestFor("openai/gpt-test"));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(payload.error).toMatchObject({ type: "rate_limit_error", code: "token_limit_exceeded" });
    expect(mocks.getComboModels).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });

  it("checks regular combos before routing", async () => {
    mocks.getComboByName.mockResolvedValue({ name: "paid_combo", isFree: false });
    mocks.getComboModels.mockResolvedValue(["openai/gpt-test"]);

    await handleChat(requestFor("paid_combo"));

    expect(mocks.checkKeyLimits).toHaveBeenCalledWith("sk-chat-test");
    expect(mocks.handleChatCore).toHaveBeenCalledOnce();
    expect(mocks.handleChatCore.mock.calls[0][0].clientRawRequest.usageMeta).toMatchObject({
      startedAt: expect.any(String),
    });
  });
});

describe("free-combo usage metadata", () => {
  it("bypasses limits and marks ordinary combo writes unmetered", async () => {
    mocks.getComboByName.mockResolvedValue({ name: "free_combo", isFree: true });
    mocks.getComboModels.mockResolvedValue(["openai/gpt-test"]);

    await handleChat(requestFor("free_combo"));

    expect(mocks.checkKeyLimits).not.toHaveBeenCalled();
    expect(mocks.handleChatCore.mock.calls[0][0].clientRawRequest.usageMeta).toMatchObject({
      requestedModel: "free_combo",
      metered: false,
      startedAt: expect.any(String),
    });
  });

  it("marks fusion panel and judge calls unmetered", async () => {
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      comboStrategy: "fallback",
      comboStrategies: { free_fusion: { fallbackStrategy: "fusion", judgeModel: "openai/judge" } },
    });
    mocks.getComboByName.mockResolvedValue({ name: "free_fusion", isFree: true });
    mocks.getComboModels.mockResolvedValue(["openai/panel"]);
    mocks.handleFusionChat.mockImplementation(async ({ handleSingleModel }) => {
      await handleSingleModel({ model: "openai/panel" }, "openai/panel", true);
      return handleSingleModel({ model: "openai/judge" }, "openai/judge", false);
    });

    await handleChat(requestFor("free_fusion"));

    expect(mocks.handleChatCore).toHaveBeenCalledTimes(2);
    for (const [options] of mocks.handleChatCore.mock.calls) {
      expect(options.clientRawRequest.usageMeta).toMatchObject({
        requestedModel: "free_fusion",
        metered: false,
        startedAt: expect.any(String),
      });
      expect(Object.isFrozen(options.clientRawRequest.usageMeta)).toBe(true);
    }
  });

  it("does not lose an outer free marker when nested combo routing is encountered", async () => {
    mocks.getComboByName.mockImplementation(async (name) => ({ name, isFree: name === "outer_free" }));
    mocks.getComboModels.mockImplementation(async (name) => {
      if (name === "outer_free") return ["nested_paid"];
      if (name === "nested_paid") return ["openai/gpt-test"];
      return null;
    });
    mocks.getModelInfo.mockImplementation(async (name) => name === "nested_paid"
      ? { provider: null, model: name }
      : { provider: "openai", model: "gpt-test" });

    await handleChat(requestFor("outer_free"));

    expect(mocks.handleChatCore.mock.calls[0][0].clientRawRequest.usageMeta).toMatchObject({
      requestedModel: "outer_free",
      metered: false,
      startedAt: expect.any(String),
    });
  });
});
