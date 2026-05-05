import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  getApiKeys: vi.fn(),
}));

vi.mock("open-sse/config/providerModels.js", () => ({
  getProviderModels: vi.fn(() => []),
  PROVIDER_ID_TO_ALIAS: {
    "kimi-coding": "kmc",
  },
}));

vi.mock("@/shared/constants/providers", () => ({
  isOpenAICompatibleProvider: vi.fn(() => false),
  isAnthropicCompatibleProvider: vi.fn(() => false),
}));

describe("POST /api/providers/[id]/test-models for kimi-coding", () => {
  let POST;
  let getProviderConnectionById;
  let getApiKeys;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ getProviderConnectionById, getApiKeys } = await import("@/lib/localDb"));
    ({ POST } = await import("../../src/app/api/providers/[id]/test-models/route.js"));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("falls back to live /models for kimi-coding when no static models exist", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "kimi-coding",
      isActive: true,
    });
    getApiKeys.mockResolvedValue([{ key: "internal-key", isActive: true }]);

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ id: "kimi-for-coding", name: "Kimi-k2.6" }],
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () => "",
      });

    const response = await POST(
      new Request("http://localhost/api/providers/conn-1/test-models", { method: "POST" }),
      { params: Promise.resolve({ id: "conn-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([
      expect.objectContaining({
        modelId: "kimi-for-coding",
        name: "Kimi-k2.6",
        ok: true,
      }),
    ]);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost/api/providers/conn-1/models"
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer internal-key",
        }),
      })
    );
  });
});
