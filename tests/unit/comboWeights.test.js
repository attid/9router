import { describe, it, expect } from "vitest";
import { normalizeComboModels } from "../../src/lib/comboUtils.js";

describe("normalizeComboModels", () => {
  it("converts string array to objects with weight 1", () => {
    const result = normalizeComboModels(["cc/claude-sonnet-4", "openrouter/gpt-4o"]);
    expect(result).toEqual([
      { model: "cc/claude-sonnet-4", weight: 1 },
      { model: "openrouter/gpt-4o", weight: 1 },
    ]);
  });

  it("passes through valid objects unchanged", () => {
    const input = [
      { model: "cc/claude-sonnet-4", weight: 2 },
      { model: "openrouter/gpt-4o", weight: 0 },
    ];
    expect(normalizeComboModels(input)).toEqual(input);
  });

  it("handles mixed array (strings + objects)", () => {
    const result = normalizeComboModels([
      "cc/claude-sonnet-4",
      { model: "openrouter/gpt-4o", weight: 3 },
    ]);
    expect(result).toEqual([
      { model: "cc/claude-sonnet-4", weight: 1 },
      { model: "openrouter/gpt-4o", weight: 3 },
    ]);
  });

  it("returns empty array for null/undefined", () => {
    expect(normalizeComboModels(null)).toEqual([]);
    expect(normalizeComboModels(undefined)).toEqual([]);
  });

  it("defaults missing weight to 1", () => {
    const result = normalizeComboModels([{ model: "cc/claude-sonnet-4" }]);
    expect(result).toEqual([{ model: "cc/claude-sonnet-4", weight: 1 }]);
  });
});
