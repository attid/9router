import { afterEach, describe, expect, it, vi } from "vitest";

import { apiPath, appUrl, normalizeBasePath } from "../../src/shared/utils/basePath.mjs";
import { clientPingUrl } from "../../src/app/(dashboard)/dashboard/endpoint/endpointPing.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("normalizeBasePath", () => {
  it.each([
    [undefined, ""],
    ["", ""],
    ["/", ""],
    ["9router", "/9router"],
    ["/9router/", "/9router"],
    ["///9router///nested///", "/9router/nested"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeBasePath(input)).toBe(expected);
  });
});

describe("apiPath", () => {
  it("prefixes a root-relative path", () => {
    expect(apiPath("/api/settings", "/9router")).toBe("/9router/api/settings");
  });

  it("preserves query strings and fragments", () => {
    expect(apiPath("/api/settings?tab=auth#oidc", "/9router/")).toBe(
      "/9router/api/settings?tab=auth#oidc"
    );
  });

  it("is idempotent for an already-prefixed path", () => {
    const once = apiPath("/api/settings", "/9router");
    expect(apiPath(once, "/9router")).toBe(once);
  });

  it.each([
    "https://example.com/api/settings",
    "http://example.com/api/settings",
    "//cdn.example.com/icon.svg",
    "data:image/svg+xml;base64,abc",
    "blob:https://example.com/id",
  ])("leaves non-local URL %s unchanged", (url) => {
    expect(apiPath(url, "/9router")).toBe(url);
  });
});

describe("appUrl", () => {
  it.each([
    ["/v1", "http://localhost:20128", "/nine", "http://localhost:20128/nine/v1"],
    ["/api/health", "https://demo.trycloudflare.com/", "/nine", "https://demo.trycloudflare.com/nine/api/health"],
    ["/callback?code=...", "http://localhost:20128", "/nine", "http://localhost:20128/nine/callback?code=..."],
    ["", "http://127.0.0.1:20128/", "/nine", "http://127.0.0.1:20128/nine"],
    ["/api/health", "https://example.com/nine/", "/nine", "https://example.com/nine/api/health"],
  ])("joins %s to %s with base path %s", (pathname, origin, basePath, expected) => {
    expect(appUrl(pathname, origin, basePath)).toBe(expected);
  });

  it("does not alter an external absolute URL", () => {
    expect(appUrl("https://api.openai.com/v1", "http://localhost:20128", "/nine"))
      .toBe("https://api.openai.com/v1");
  });
});

describe("endpoint health probes", () => {
  it("adds the configured base path between the tunnel origin and health path", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/nine");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    expect(await clientPingUrl("https://demo.trycloudflare.com/")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://demo.trycloudflare.com/nine/api/health",
      expect.objectContaining({ mode: "cors", cache: "no-store" })
    );
  });
});
