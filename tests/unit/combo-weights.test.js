import { describe, expect, it } from "vitest";

import {
  getComboModelName,
  getComboModelNames,
  normalizeComboModels,
  validateComboModels,
} from "../../src/lib/comboUtils.js";

describe("combo model normalization", () => {
  it("normalizes legacy strings and mixed structured members", () => {
    expect(normalizeComboModels([
      "provider/legacy",
      { model: "provider/weighted", weight: 3 },
      { model: "provider/default" },
    ])).toEqual([
      { model: "provider/legacy", weight: 1 },
      { model: "provider/weighted", weight: 3 },
      { model: "provider/default", weight: 1 },
    ]);
  });

  it("trims model ids at the normalization boundary", () => {
    expect(normalizeComboModels([
      "  provider/legacy  ",
      { model: " provider/weighted ", weight: 3 },
    ])).toEqual([
      { model: "provider/legacy", weight: 1 },
      { model: "provider/weighted", weight: 3 },
    ]);
    expect(getComboModelNames([" provider/a ", { model: " provider/b " }]))
      .toEqual(["provider/a", "provider/b"]);
  });

  it("extracts names without exposing structured members to consumers", () => {
    const members = ["provider/legacy", { model: "provider/new", weight: 0 }];
    expect(getComboModelName(members[0])).toBe("provider/legacy");
    expect(getComboModelName(members[1])).toBe("provider/new");
    expect(getComboModelNames(members)).toEqual(["provider/legacy", "provider/new"]);
  });

  it("does not mutate structured input", () => {
    const input = [{ model: "provider/a", weight: 2 }];
    const result = normalizeComboModels(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result[0]).not.toBe(input[0]);
  });

  it("accepts strings and non-negative integer weights", () => {
    expect(validateComboModels(["provider/a", { model: "provider/b", weight: 0 }])).toBeNull();
    expect(validateComboModels([{ model: "provider/a", weight: 12 }])).toBeNull();
    expect(validateComboModels([" provider/a "])).toBeNull();
  });

  it.each([
    [null, "Models must be an array"],
    [[""], "Model at index 0 must be a non-empty string"],
    [[{}], "Model at index 0 must be a non-empty string"],
    [[{ model: "provider/a", weight: -1 }], "Weight at index 0 must be a non-negative integer"],
    [[{ model: "provider/a", weight: 1.5 }], "Weight at index 0 must be a non-negative integer"],
    [[{ model: "provider/a", weight: "2" }], "Weight at index 0 must be a non-negative integer"],
  ])("rejects malformed members %#", (models, message) => {
    expect(validateComboModels(models)).toBe(message);
  });
});
