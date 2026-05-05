import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/basePath.js", () => ({
  apiPath: vi.fn((path) => `/9router${path}`),
}));

describe("endpoint key paths", () => {
  it("prefixes key usage and update routes with base path", async () => {
    const { buildKeyUsagePath, buildKeyRoutePath } = await import("../../src/app/(dashboard)/dashboard/endpoint/keyPaths.js");

    expect(buildKeyUsagePath("key-123")).toBe("/9router/api/keys/key-123/usage");
    expect(buildKeyRoutePath("key-123")).toBe("/9router/api/keys/key-123");
  });
});
