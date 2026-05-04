import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async () => ({})),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => ({ kind: "next" })),
    redirect: vi.fn((url) => ({ kind: "redirect", url: String(url) })),
    json: vi.fn((body, init) => ({ kind: "json", body, init })),
  },
}));

const mockSettings = vi.fn(async () => ({ requireLogin: true, tunnelDashboardAccess: true }));
vi.mock("../../src/lib/localDb.js", () => ({
  getSettings: (...a) => mockSettings(...a),
}));

vi.mock("../../src/lib/auth.js", () => ({
  JWT_SECRET: new TextEncoder().encode("test-secret"),
}));

vi.mock("../../src/shared/utils/machineId.js", () => ({
  getConsistentMachineId: vi.fn(async () => "machine-id"),
}));

function fakeRequest(pathname, { token } = {}) {
  return {
    nextUrl: { pathname },
    url: `http://localhost:20128${pathname}`,
    cookies: { get: () => (token ? { value: token } : undefined) },
    headers: { get: () => "" },
  };
}

async function loadGuard(env = {}) {
  vi.resetModules();
  for (const k of ["BASE_PATH", "NEXT_PUBLIC_BASE_PATH"]) delete process.env[k];
  Object.assign(process.env, env);
  // re-apply module mocks after resetModules
  vi.doMock("jose", () => ({ jwtVerify: vi.fn(async () => ({})) }));
  vi.doMock("next/server", () => ({
    NextResponse: {
      next: vi.fn(() => ({ kind: "next" })),
      redirect: vi.fn((url) => ({ kind: "redirect", url: String(url) })),
      json: vi.fn((body, init) => ({ kind: "json", body, init })),
    },
  }));
  vi.doMock("../../src/lib/localDb.js", () => ({ getSettings: (...a) => mockSettings(...a) }));
  vi.doMock("../../src/lib/auth.js", () => ({ JWT_SECRET: new TextEncoder().encode("test-secret") }));
  vi.doMock("../../src/shared/utils/machineId.js", () => ({
    getConsistentMachineId: vi.fn(async () => "machine-id"),
  }));
  return await import("../../src/dashboardGuard.js");
}

beforeEach(() => {
  mockSettings.mockReset();
  mockSettings.mockResolvedValue({ requireLogin: true, tunnelDashboardAccess: true });
});

afterEach(() => {
  for (const k of ["BASE_PATH", "NEXT_PUBLIC_BASE_PATH"]) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("dashboardGuard with BASE_PATH", () => {
  it("redirects unauthenticated /dashboard to /login (no prefix when BASE_PATH unset)", async () => {
    const { proxy } = await loadGuard({});
    const res = await proxy(fakeRequest("/dashboard"));
    expect(res.kind).toBe("redirect");
    expect(res.url).toBe("http://localhost:20128/login");
  });

  it("redirects unauthenticated /dashboard to /9router/login when BASE_PATH=/9router", async () => {
    const { proxy } = await loadGuard({ BASE_PATH: "/9router" });
    const res = await proxy(fakeRequest("/dashboard"));
    expect(res.kind).toBe("redirect");
    expect(res.url).toBe("http://localhost:20128/9router/login");
  });

  it("redirects / to /dashboard with BASE_PATH prefix", async () => {
    const { proxy } = await loadGuard({ BASE_PATH: "/9router" });
    const res = await proxy(fakeRequest("/"));
    expect(res.kind).toBe("redirect");
    expect(res.url).toBe("http://localhost:20128/9router/dashboard");
  });

  it("redirects / to /dashboard without prefix when BASE_PATH is unset", async () => {
    const { proxy } = await loadGuard({});
    const res = await proxy(fakeRequest("/"));
    expect(res.kind).toBe("redirect");
    expect(res.url).toBe("http://localhost:20128/dashboard");
  });

  it("matches public-API paths against the un-prefixed pathname", async () => {
    // Next.js strips basePath from nextUrl.pathname before matchers fire,
    // so public-path matching must continue to use bare /api/... paths.
    const { proxy } = await loadGuard({ BASE_PATH: "/9router" });
    const res = await proxy(fakeRequest("/api/v1/messages"));
    expect(res.kind).toBe("next");
  });
});
