import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const source = fs.readFileSync(
  path.resolve(repoRoot, "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js"),
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

  it("sends allowedModels for key creation and saves existing-key drafts on close", () => {
    expect(source).toMatch(/body:\s*JSON\.stringify\(\{\s*name:\s*newKeyName,\s*allowedModels\s*\}\)/s);
    expect(source).toMatch(/body:\s*JSON\.stringify\(\{\s*allowedModels\s*\}\)/s);
    expect(source).toContain("existingKeyModelsDraft");
    expect(source).toContain("handleCloseModelSelect");
    expect(source).not.toMatch(/handleSelectAllowedModel[\s\S]*updateAllowedModels\(modelSelectTarget, next\)/);
    const closeHandler = source.slice(
      source.indexOf("const handleCloseModelSelect"),
      source.indexOf("const maskKey")
    );
    expect(closeHandler.indexOf("setExistingKeyModelsDraft([])")).toBeLessThan(
      closeHandler.indexOf("await updateAllowedModels")
    );
  });

  it("stores the request-facing name when an alias is selected", () => {
    expect(source).toContain("model?.requestValue || model?.value");
    const modalSource = fs.readFileSync(
      path.resolve(repoRoot, "src/shared/components/ModelSelectModal.js"),
      "utf8"
    );
    expect(modalSource).toContain("requestValue: aliasName");
  });

  it("makes unrestricted and restricted key state visible", () => {
    expect(source).toContain("All models allowed");
    expect(source).toContain("Allowed models");
    expect(source).toContain("Leave empty to allow all models.");
  });

  it("allows an exact model ID to be added when discovery does not list it", () => {
    expect(source).toContain("allowManualEntry");

    const modalSource = fs.readFileSync(
      path.resolve(repoRoot, "src/shared/components/ModelSelectModal.js"),
      "utf8"
    );
    expect(modalSource).toContain('placeholder="provider/model-id"');
    expect(modalSource).toContain("manualModelId.trim()");
    expect(modalSource).toContain("requestValue: value");
    expect(modalSource).toContain("addedModelValues.includes(value)");
  });
});
