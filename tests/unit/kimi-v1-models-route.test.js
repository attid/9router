import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshTokenByProviderMock = vi.fn();
const updateProviderCredentialsMock = vi.fn();

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/shared/constants/models", () => ({
  PROVIDER_MODELS: {
    kmc: [],
  },
  PROVIDER_ID_TO_ALIAS: {
    "kimi-coding": "kmc",
  },
}));

vi.mock("@/shared/constants/providers", async () => {
  const actual = await vi.importActual("@/shared/constants/providers");
  return {
    ...actual,
    getProviderAlias: vi.fn((providerId) => (providerId === "kimi-coding" ? "kmc" : providerId)),
    isOpenAICompatibleProvider: vi.fn(() => false),
    isAnthropicCompatibleProvider: vi.fn(() => false),
  };
});

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  refreshTokenByProvider: refreshTokenByProviderMock,
  updateProviderCredentials: updateProviderCredentialsMock,
}));

describe("GET /api/v1/models for kimi-coding", () => {
  let GET;
  let localDb;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    localDb = await import("@/lib/localDb");
    ({ GET } = await import("../../src/app/api/v1/models/route.js"));
    localDb.getCombos.mockResolvedValue([]);
    localDb.getCustomModels.mockResolvedValue([]);
    localDb.getModelAliases.mockResolvedValue({});
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("exposes the live kimi coding model instead of stale static aliases", async () => {
    localDb.getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "kimi-coding",
        isActive: true,
        accessToken: "access-token",
        refreshToken: "refresh-token",
        providerSpecificData: {},
      },
    ]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ id: "kimi-for-coding", display_name: "Kimi-k2.6" }],
      }),
      text: async () => "",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "kmc/kimi-for-coding",
        owned_by: "kmc",
      }),
    ]);
    expect(global.fetch).toHaveBeenCalled();
  });
});
