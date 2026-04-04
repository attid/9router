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

const mockGetProviderConnectionById = vi.fn();

vi.mock("@/models", () => ({
  getProviderConnectionById: mockGetProviderConnectionById,
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn(),
}));

function makeJwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.sig`;
}

describe("GET /api/providers/[id] token info", () => {
  let GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/providers/[id]/route.js");
    GET = mod.GET;
  });

  it("returns safe tokenInfo and strips secrets", async () => {
    mockGetProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      name: "Codex",
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      idToken: makeJwt({ exp: 2000000000, iat: 1999990000, auth_time: 1999980000 }),
      expiresAt: "2026-04-15T12:00:00.000Z",
      apiKey: "secret-api-key",
    });

    const response = await GET({}, { params: Promise.resolve({ id: "conn-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.connection.tokenInfo).toEqual({
      accessTokenExpiresAt: "2026-04-15T12:00:00.000Z",
      idTokenClaims: {
        exp: 2000000000,
        iat: 1999990000,
        auth_time: 1999980000,
      },
      hasRefreshToken: true,
      authType: "oauth",
    });
    expect(body.connection.accessToken).toBeUndefined();
    expect(body.connection.refreshToken).toBeUndefined();
    expect(body.connection.idToken).toBeUndefined();
    expect(body.connection.apiKey).toBeUndefined();
  });

  it("returns null idTokenClaims when token is invalid", async () => {
    mockGetProviderConnectionById.mockResolvedValue({
      id: "conn-2",
      provider: "codex",
      authType: "oauth",
      name: "Codex",
      refreshToken: null,
      idToken: "bad-token",
      expiresAt: null,
    });

    const response = await GET({}, { params: Promise.resolve({ id: "conn-2" }) });
    const body = await response.json();

    expect(body.connection.tokenInfo).toEqual({
      accessTokenExpiresAt: null,
      idTokenClaims: null,
      hasRefreshToken: false,
      authType: "oauth",
    });
  });
});
