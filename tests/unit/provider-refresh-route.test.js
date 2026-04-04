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
const mockGetAccessToken = vi.fn();
const mockUpdateProviderCredentials = vi.fn();

vi.mock("@/models", () => ({
  getProviderConnectionById: mockGetProviderConnectionById,
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  getAccessToken: mockGetAccessToken,
  updateProviderCredentials: mockUpdateProviderCredentials,
}));

function makeJwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.sig`;
}

describe("POST /api/providers/[id]/refresh", () => {
  let POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/providers/[id]/refresh/route.js");
    POST = mod.POST;
  });

  it("returns 404 when connection does not exist", async () => {
    mockGetProviderConnectionById.mockResolvedValue(null);

    const response = await POST({}, { params: Promise.resolve({ id: "missing" }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Connection not found");
  });

  it("returns 400 when connection cannot be refreshed", async () => {
    mockGetProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      refreshToken: null,
    });

    const response = await POST({}, { params: Promise.resolve({ id: "conn-1" }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Refresh token is not available for this connection");
  });

  it("refreshes tokens, persists them, and returns sanitized token info", async () => {
    mockGetProviderConnectionById
      .mockResolvedValueOnce({
        id: "conn-1",
        provider: "codex",
        authType: "oauth",
        name: "Codex",
        refreshToken: "old-refresh",
        accessToken: "old-access",
        idToken: makeJwt({ exp: 2000000000, iat: 1999990000, auth_time: 1999980000 }),
        expiresAt: "2026-04-15T12:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "conn-1",
        provider: "codex",
        authType: "oauth",
        name: "Codex",
        refreshToken: "new-refresh",
        accessToken: "new-access",
        idToken: makeJwt({ exp: 2000001000, iat: 1999991000, auth_time: 1999981000 }),
        expiresAt: "2026-04-15T13:00:00.000Z",
      });

    mockGetAccessToken.mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 3600,
    });
    mockUpdateProviderCredentials.mockResolvedValue(true);

    const response = await POST({}, { params: Promise.resolve({ id: "conn-1" }) });
    const body = await response.json();

    expect(mockGetAccessToken).toHaveBeenCalledWith("codex", expect.objectContaining({
      id: "conn-1",
      connectionId: "conn-1",
      refreshToken: "old-refresh",
    }));
    expect(mockUpdateProviderCredentials).toHaveBeenCalledWith("conn-1", {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 3600,
    });
    expect(response.status).toBe(200);
    expect(body.connection.tokenInfo).toEqual({
      accessTokenExpiresAt: "2026-04-15T13:00:00.000Z",
      idTokenClaims: {
        exp: 2000001000,
        iat: 1999991000,
        auth_time: 1999981000,
      },
      hasRefreshToken: true,
      authType: "oauth",
    });
    expect(body.connection.accessToken).toBeUndefined();
    expect(body.connection.refreshToken).toBeUndefined();
    expect(body.connection.idToken).toBeUndefined();
  });

  it("surfaces upstream refresh failures with status and details", async () => {
    mockGetProviderConnectionById.mockResolvedValue({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      refreshToken: "old-refresh",
    });

    const error = new Error("refresh token expired");
    error.status = 401;
    error.details = "re-auth needed";
    mockGetAccessToken.mockRejectedValue(error);

    const response = await POST({}, { params: Promise.resolve({ id: "conn-1" }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("refresh token expired");
    expect(body.details).toBe("re-auth needed");
  });
});
