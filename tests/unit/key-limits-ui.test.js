import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath) => fs.readFileSync(path.resolve(relativePath), "utf8");

describe("API-key limits dashboard", () => {
  const source = read("src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");

  it("supports limits during creation and editing", () => {
    expect(source).toContain("newKeyLimits");
    expect(source).toContain("editLimitsValues");
    expect(source).toContain("handleSaveLimits");
    expect(source).toContain('(["hourly", "daily", "weekly"])');
    expect(source).toContain("Token Limits");
  });

  it("fetches usage and displays bounded progress for configured periods", () => {
    expect(source).toContain("/usage`");
    expect(source).toContain("LimitProgressBar");
    expect(source).toContain("Math.min((used / limit) * 100, 100)");
  });

  it("does not include the separate model overlay or later rename/filter controls", () => {
    expect(source).not.toContain("allowedModels");
    expect(source).not.toContain("keySearch");
    expect(source).not.toContain("editingKeyName");
    expect(source).not.toContain("handleRenameKey");
  });
});

describe("free combo dashboard and API", () => {
  const ui = read("src/app/(dashboard)/dashboard/combos/page.js");
  const createRoute = read("src/app/api/combos/route.js");
  const updateRoute = read("src/app/api/combos/[id]/route.js");

  it("shows an explicit free toggle and badge", () => {
    expect(ui).toContain("Free / unmetered combo");
    expect(ui).toContain("combo.isFree === true");
    expect(ui).toContain("FREE");
    expect(ui).toContain("await onSave({ name: name.trim(), models, isFree })");
  });

  it("accepts only boolean true for isFree at API boundaries", () => {
    expect(createRoute).toContain("isFree: isFree === true");
    expect(updateRoute).toContain('Object.hasOwn(body, "isFree")');
    expect(updateRoute).toContain("body.isFree = body.isFree === true");
  });
});
