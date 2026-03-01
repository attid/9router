import { describe, it, expect } from "vitest";
import { normalizeComboModels } from "../../src/lib/comboUtils.js";
import { buildWeightedCycle, pickNextModel } from "../../open-sse/services/combo.js";

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

describe("buildWeightedCycle", () => {
  it("expands weights into cycle array", () => {
    const models = [
      { model: "A", weight: 2 },
      { model: "B", weight: 1 },
    ];
    expect(buildWeightedCycle(models)).toEqual(["A", "A", "B"]);
  });

  it("returns empty for no weighted models", () => {
    const models = [{ model: "A", weight: 0 }];
    expect(buildWeightedCycle(models)).toEqual([]);
  });

  it("handles single model", () => {
    const models = [{ model: "A", weight: 3 }];
    expect(buildWeightedCycle(models)).toEqual(["A", "A", "A"]);
  });
});

describe("pickNextModel", () => {
  it("cycles through models round-robin", () => {
    const counters = new Map();
    const cycle = ["A", "A", "B"];

    expect(pickNextModel("test-combo", cycle, counters)).toBe("A");
    expect(pickNextModel("test-combo", cycle, counters)).toBe("A");
    expect(pickNextModel("test-combo", cycle, counters)).toBe("B");
    expect(pickNextModel("test-combo", cycle, counters)).toBe("A"); // wraps
  });

  it("maintains separate counters per combo", () => {
    const counters = new Map();
    const cycle = ["A", "B"];

    expect(pickNextModel("combo1", cycle, counters)).toBe("A");
    expect(pickNextModel("combo2", cycle, counters)).toBe("A");
    expect(pickNextModel("combo1", cycle, counters)).toBe("B");
    expect(pickNextModel("combo2", cycle, counters)).toBe("B");
  });
});
