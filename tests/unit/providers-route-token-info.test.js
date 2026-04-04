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

const mockGetProviderConnections = vi.fn();
const mockGetProviderNodes = vi.fn();

vi.mock("@/models", () => ({
  getProviderConnections: mockGetProviderConnections,
  createProviderConnection: vi.fn(),
  getProviderNodeById: vi.fn(),
  getProviderNodes: mockGetProviderNodes,
}));

vi.mock("@/shared/constants/config", () => ({
  APIKEY_PROVIDERS: {},
}));

vi.mock("@/shared/constants/providers", () => ({
  isOpenAICompatibleProvider: vi.fn(() => false),
  isAnthropicCompatibleProvider: vi.fn(() => false),
}));

function makeJwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.sig`;
}

describe("GET /api/providers token info", () => {
  let GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetProviderNodes.mockResolvedValue([]);
    const mod = await import("../../src/app/api/providers/route.js");
    GET = mod.GET;
  });

  it("returns safe tokenInfo and strips sensitive token fields", async () => {
    mockGetProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "codex",
        authType: "oauth",
        name: "Codex",
        accessToken: "secret-access",
        refreshToken: "secret-refresh",
        idToken: makeJwt({ exp: 2000000000, iat: 1999990000, auth_time: 1999980000 }),
        expiresAt: "2026-04-15T12:00:00.000Z",
        apiKey: "secret-api-key",
      },
    ]);

    const response = await GET();
    const body = await response.json();
    const connection = body.connections[0];

    expect(response.status).toBe(200);
    expect(connection.tokenInfo).toEqual({
      accessTokenExpiresAt: "2026-04-15T12:00:00.000Z",
      idTokenClaims: {
        exp: 2000000000,
        iat: 1999990000,
        auth_time: 1999980000,
      },
      hasRefreshToken: true,
      authType: "oauth",
    });
    expect(connection.accessToken).toBeUndefined();
    expect(connection.refreshToken).toBeUndefined();
    expect(connection.idToken).toBeUndefined();
    expect(connection.apiKey).toBeUndefined();
  });

  it("returns null idTokenClaims for missing or invalid id tokens", async () => {
    mockGetProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "codex",
        authType: "oauth",
        name: "Missing token",
        refreshToken: "refresh",
        expiresAt: null,
      },
      {
        id: "conn-2",
        provider: "codex",
        authType: "oauth",
        name: "Invalid token",
        refreshToken: null,
        idToken: "not-a-jwt",
        expiresAt: null,
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(body.connections[0].tokenInfo).toEqual({
      accessTokenExpiresAt: null,
      idTokenClaims: null,
      hasRefreshToken: true,
      authType: "oauth",
    });
    expect(body.connections[1].tokenInfo).toEqual({
      accessTokenExpiresAt: null,
      idTokenClaims: null,
      hasRefreshToken: false,
      authType: "oauth",
    });
  });
});
