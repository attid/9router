import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
}));

vi.mock("@/shared/constants/providers", () => ({
  isOpenAICompatibleProvider: vi.fn(() => false),
  isAnthropicCompatibleProvider: vi.fn(() => false),
}));

vi.mock("@/lib/oauth/services/kiro", () => ({
  KiroService: class {},
}));

vi.mock("@/lib/oauth/constants/oauth.js", () => ({
  GEMINI_CONFIG: { clientId: "client", clientSecret: "secret" },
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
  refreshKiroToken: vi.fn(),
}));

vi.mock("open-sse/config/providers.js", () => ({
  resolveOllamaLocalHost: vi.fn(),
}));

describe("GET /api/providers/[id]/models for kimi-coding", () => {
  let GET;
  let getProviderConnectionById;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ getProviderConnectionById } = await import("@/models"));
    ({ GET } = await import("../../src/app/api/providers/[id]/models/route.js"));
  });

  it("fetches Kimi models from the coding models endpoint with Kimi headers", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "kimi-coding",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "kimi-for-coding", display_name: "Kimi For Coding" }],
      }),
    });

    const response = await GET(new Request("http://localhost/api/providers/conn-1/models"), {
      params: Promise.resolve({ id: "conn-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.body.models).toEqual([
      { id: "kimi-for-coding", display_name: "Kimi For Coding" },
    ]);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.kimi.com/coding/v1/models");
    expect(init.headers.Authorization).toBe("Bearer access-token");
    expect(init.headers["User-Agent"]).toBe("KimiCLI/1.37.0");
    expect(init.headers["X-Msh-Platform"]).toBe("kimi_cli");
  });
});
