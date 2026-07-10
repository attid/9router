import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js"),
  "utf8"
);

describe("endpoint API-key model controls", () => {
  it("uses the current model selector with add/remove multi-selection", () => {
    expect(source).toContain('import ModelSelectModal from "@/shared/components/ModelSelectModal"');
    expect(source).toContain("addedModelValues={selectedAllowedModels}");
    expect(source).toContain("onDeselect={handleDeselectAllowedModel}");
    expect(source).toContain("closeOnSelect={false}");
  });

  it("loads current providers and aliases for the selector", () => {
    expect(source).toContain('fetch("/api/providers")');
    expect(source).toContain('fetch("/api/models/alias")');
    expect(source).toContain("setActiveProviders");
    expect(source).toContain("setModelAliases");
  });

  it("sends allowedModels for key creation and updates", () => {
    expect(source).toMatch(/body:\s*JSON\.stringify\(\{\s*name:\s*newKeyName,\s*allowedModels\s*\}\)/s);
    expect(source).toMatch(/body:\s*JSON\.stringify\(\{\s*allowedModels\s*\}\)/s);
  });

  it("makes unrestricted and restricted key state visible", () => {
    expect(source).toContain("All models allowed");
    expect(source).toContain("Allowed models");
    expect(source).toContain("Leave empty to allow all models.");
  });
});
