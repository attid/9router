import { describe, it, expect } from "vitest";
import {
  buildHiddenModelsMap,
  computeHiddenFromVisible,
  isModelHiddenForProvider,
} from "@/shared/utils/modelVisibility";

describe("modelVisibility utils", () => {
  it("checks hidden model by alias and provider id", () => {
    const hidden = {
      codex: ["a"],
      "openai-compatible-1": ["b"],
    };

    expect(
      isModelHiddenForProvider(hidden, {
        aliasKey: "codex",
        providerIdKey: "openai-compatible-1",
        modelId: "a",
      })
    ).toBe(true);

    expect(
      isModelHiddenForProvider(hidden, {
        aliasKey: "codex",
        providerIdKey: "openai-compatible-1",
        modelId: "b",
      })
    ).toBe(true);

    expect(
      isModelHiddenForProvider(hidden, {
        aliasKey: "codex",
        providerIdKey: "openai-compatible-1",
        modelId: "c",
      })
    ).toBe(false);
  });

  it("computes hidden models as complement of visible", () => {
    const all = ["m1", "m2", "m3"];
    const visible = ["m2"];

    expect(computeHiddenFromVisible(all, visible)).toEqual(["m1", "m3"]);
  });

  it("builds next hiddenModels map and removes empty provider entries", () => {
    const initial = {
      codex: ["m1"],
      openai: ["x"],
    };

    const withHidden = buildHiddenModelsMap(initial, "codex", ["m2", "m1"]);
    expect(withHidden).toEqual({
      codex: ["m1", "m2"],
      openai: ["x"],
    });

    const cleared = buildHiddenModelsMap(withHidden, "codex", []);
    expect(cleared).toEqual({
      openai: ["x"],
    });
  });
});
