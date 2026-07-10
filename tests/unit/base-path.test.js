import { describe, expect, it } from "vitest";

import { apiPath, normalizeBasePath } from "../../src/shared/utils/basePath.mjs";

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
