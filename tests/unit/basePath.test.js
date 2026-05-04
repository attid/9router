import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadModule(env = {}) {
  vi.resetModules();
  for (const k of ["BASE_PATH", "NEXT_PUBLIC_BASE_PATH"]) delete process.env[k];
  Object.assign(process.env, env);
  return await import("../../src/lib/basePath.js");
}

afterEach(() => {
  for (const k of ["BASE_PATH", "NEXT_PUBLIC_BASE_PATH"]) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("basePath helper", () => {
  it("returns input untouched when BASE_PATH is unset", async () => {
    const { apiPath, dashboardPath, BASE_PATH } = await loadModule({});
    expect(BASE_PATH).toBe("");
    expect(apiPath("/api/foo")).toBe("/api/foo");
    expect(dashboardPath("/dashboard/x")).toBe("/dashboard/x");
  });

  it("prefixes paths when BASE_PATH is set", async () => {
    const { apiPath, dashboardPath, BASE_PATH } = await loadModule({ BASE_PATH: "/9router" });
    expect(BASE_PATH).toBe("/9router");
    expect(apiPath("/api/foo")).toBe("/9router/api/foo");
    expect(dashboardPath("/dashboard")).toBe("/9router/dashboard");
  });

  it("is idempotent — passing an already-prefixed path returns it unchanged", async () => {
    const { apiPath } = await loadModule({ BASE_PATH: "/9router" });
    expect(apiPath("/9router/api/foo")).toBe("/9router/api/foo");
    expect(apiPath("/9router")).toBe("/9router");
  });

  it("normalises trailing slash on BASE_PATH", async () => {
    const { apiPath, BASE_PATH } = await loadModule({ BASE_PATH: "/9router/" });
    expect(BASE_PATH).toBe("/9router");
    expect(apiPath("/api/foo")).toBe("/9router/api/foo");
  });

  it("adds a leading slash when BASE_PATH lacks one", async () => {
    const { BASE_PATH } = await loadModule({ BASE_PATH: "9router" });
    expect(BASE_PATH).toBe("/9router");
  });

  it("accepts input paths without leading slash", async () => {
    const { apiPath } = await loadModule({ BASE_PATH: "/9router" });
    expect(apiPath("api/foo")).toBe("/9router/api/foo");
  });

  it("prefers NEXT_PUBLIC_BASE_PATH over BASE_PATH (client-visible value wins)", async () => {
    const { BASE_PATH } = await loadModule({
      BASE_PATH: "/server-only",
      NEXT_PUBLIC_BASE_PATH: "/9router",
    });
    expect(BASE_PATH).toBe("/9router");
  });

  it("treats empty/whitespace BASE_PATH as no prefix", async () => {
    const { BASE_PATH, apiPath } = await loadModule({ BASE_PATH: "   " });
    expect(BASE_PATH).toBe("");
    expect(apiPath("/api/foo")).toBe("/api/foo");
  });

  it("returns BASE_PATH itself when given an empty input under a prefix", async () => {
    const { apiPath } = await loadModule({ BASE_PATH: "/9router" });
    expect(apiPath("")).toBe("/9router");
  });
});
