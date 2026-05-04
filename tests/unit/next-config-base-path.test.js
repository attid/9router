import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadConfig(env = {}) {
  vi.resetModules();
  for (const k of ["BASE_PATH", "NEXT_PUBLIC_BASE_PATH"]) delete process.env[k];
  Object.assign(process.env, env);
  const mod = await import("../../next.config.mjs");
  return mod.default;
}

afterEach(() => {
  for (const k of ["BASE_PATH", "NEXT_PUBLIC_BASE_PATH"]) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("next.config.mjs basePath wiring", () => {
  it("emits no basePath when BASE_PATH is unset", async () => {
    const cfg = await loadConfig({});
    // Next treats undefined as 'no basePath'; either undefined or empty is OK
    expect(cfg.basePath ?? "").toBe("");
    expect(cfg.assetPrefix ?? "").toBe("");
  });

  it("emits basePath and assetPrefix from BASE_PATH", async () => {
    const cfg = await loadConfig({ BASE_PATH: "/9router" });
    expect(cfg.basePath).toBe("/9router");
    expect(cfg.assetPrefix).toBe("/9router");
  });

  it("normalises trailing slash on BASE_PATH", async () => {
    const cfg = await loadConfig({ BASE_PATH: "/9router/" });
    expect(cfg.basePath).toBe("/9router");
  });

  it("preserves the existing rewrites array", async () => {
    const cfg = await loadConfig({ BASE_PATH: "/9router" });
    const rewrites = await cfg.rewrites();
    // Sanity: at least the codex / v1 mappings still present
    expect(Array.isArray(rewrites)).toBe(true);
    const sources = rewrites.map((r) => r.source);
    expect(sources).toContain("/v1/:path*");
    expect(sources).toContain("/codex/:path*");
  });
});
