import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getComboByName: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  checkKeyLimits: vi.fn(),
  checkComboLimits: vi.fn(),
  handleChatCore: vi.fn(),
  saveComboLimitDetail: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, getComboByName: mocks.getComboByName }));
vi.mock("@/sse/services/keyLimits.js", () => ({ checkKeyLimits: mocks.checkKeyLimits }));
vi.mock("@/sse/services/comboLimits.js", () => ({ checkComboLimits: mocks.checkComboLimits }));
vi.mock("@/sse/services/model.js", () => ({ getComboModels: mocks.getComboModels, getModelInfo: mocks.getModelInfo }));
vi.mock("@/sse/services/auth.js", () => ({
  extractApiKey: () => "sk-routing-test",
  isValidApiKey: vi.fn().mockResolvedValue(true),
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("open-sse/handlers/chatCore/requestDetail.js", () => ({ saveComboLimitDetail: mocks.saveComboLimitDetail }));
vi.mock("open-sse/providers/capabilities.js", () => ({ getCapabilitiesForModel: () => ({}) }));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: vi.fn() }));
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => new Response(JSON.stringify({ error: { message } }), { status }),
  unavailableResponse: (status, message) => new Response(JSON.stringify({ error: { message } }), { status }),
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: () => null }));
vi.mock("open-sse/config/runtimeConfig.js", () => ({
  HTTP_STATUS: { BAD_REQUEST: 400, UNAUTHORIZED: 401, NOT_FOUND: 404, RATE_LIMITED: 429, SERVICE_UNAVAILABLE: 503 },
}));
vi.mock("open-sse/translator/formats.js", () => ({
  detectFormatByEndpoint: vi.fn(),
  extractTextContent: (value) => typeof value === "string" ? value : "",
}));
vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn(), maskKey: () => "sk-routing***",
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));

import { handleChat } from "@/sse/handlers/chat.js";

const combos = {
  BIG: { id: "combo-big", name: "BIG", isFree: true, limits: null },
  free_kimi: { id: "combo-kimi", name: "free_kimi", isFree: true, limits: { hourly: 1_000 } },
  free_minimax: { id: "combo-minimax", name: "free_minimax", isFree: true, limits: { hourly: 1_000 } },
};

function requestFor(model) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-routing-test" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hello" }] }),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false, comboStrategy: "fallback" });
  combos.BIG.limits = null;
  mocks.getComboByName.mockImplementation(async (name) => combos[name] || null);
  mocks.getComboModels.mockImplementation(async (name) => {
    if (name === "BIG") return ["free_kimi", "free_minimax"];
    if (name === "free_kimi") return ["kimi/kimi-k2.5"];
    if (name === "free_minimax") return ["minimax/MiniMax-M3"];
    return null;
  });
  mocks.getModelInfo.mockImplementation(async (name) => {
    if (name === "free_kimi" || name === "free_minimax") return { provider: null, model: name };
    const [provider, model] = name.split("/");
    return { provider, model };
  });
  mocks.getProviderCredentials.mockResolvedValue({
    connectionId: "connection-1",
    connectionName: "test",
    apiKey: "provider-key",
  });
  mocks.checkKeyLimits.mockResolvedValue({ allowed: true });
  mocks.saveComboLimitDetail.mockResolvedValue(undefined);
  mocks.checkComboLimits.mockImplementation(async (_apiKey, combo) => combo.id === "combo-kimi"
    ? {
      allowed: false,
      error: "free_kimi exhausted",
      retryAfter: 60,
      resetAt: "2026-11-01T06:00:00.000Z",
      comboId: combo.id,
      comboName: combo.name,
      period: "hourly",
      used: 1_050,
      limit: 1_000,
      apiKeyId: "key-1",
      apiKeyName: "User A",
    }
    : { allowed: true });
  mocks.handleChatCore.mockImplementation(async ({ modelInfo, clientRawRequest }) => ({
    success: true,
    response: new Response(JSON.stringify({ model: modelInfo.model, comboPath: clientRawRequest.usageMeta.comboPath }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  }));
});

describe("nested combo token limit routing", () => {
  it("skips an exhausted child combo and succeeds through the next child", async () => {
    const response = await handleChat(requestFor("BIG"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.model).toBe("MiniMax-M3");
    expect(payload.comboPath).toEqual([
      { id: "combo-big", name: "BIG" },
      { id: "combo-minimax", name: "free_minimax" },
    ]);
    expect(mocks.checkComboLimits.mock.calls.map(([, combo]) => combo.name)).toEqual([
      "BIG",
      "free_kimi",
      "free_minimax",
    ]);
    expect(mocks.checkKeyLimits).not.toHaveBeenCalled();
    expect(mocks.handleChatCore).toHaveBeenCalledOnce();
    expect(mocks.saveComboLimitDetail).toHaveBeenCalledOnce();
    expect(mocks.saveComboLimitDetail).toHaveBeenCalledWith(expect.objectContaining({
      action: "branch_skipped",
      usageMeta: expect.objectContaining({
        requestedModel: "BIG",
        comboPath: [
          { id: "combo-big", name: "BIG" },
          { id: "combo-kimi", name: "free_kimi" },
        ],
      }),
    }));
  });

  it("blocks an exhausted parent before trying any child", async () => {
    combos.BIG.limits = { hourly: 1_000 };
    mocks.checkComboLimits.mockResolvedValue({
      allowed: false,
      error: "BIG exhausted",
      retryAfter: 60,
      resetAt: "2026-11-01T06:00:00.000Z",
      comboId: "combo-big",
      comboName: "BIG",
      period: "hourly",
      used: 2_000,
      limit: 1_000,
      apiKeyId: "key-1",
      apiKeyName: "User A",
    });

    const response = await handleChat(requestFor("BIG"));

    expect(response.status).toBe(429);
    expect(mocks.checkComboLimits).toHaveBeenCalledTimes(1);
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
});
