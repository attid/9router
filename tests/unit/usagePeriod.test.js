import { describe, it, expect } from "vitest";
import {
  normalizeUsagePreset,
  getUsageRange,
  rangeIncludesNow,
  buildUsageQuery,
} from "../../src/shared/utils/usagePeriod.js";

describe("usagePeriod helpers", () => {
  const fixedNow = new Date("2026-03-03T15:30:00.000Z");

  const localStartOfDayIso = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  };

  const localEndOfDayIso = (date) => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  };

  it("normalizes unknown preset to today", () => {
    expect(normalizeUsagePreset("unknown")).toBe("today");
  });

  it("builds today range", () => {
    const range = getUsageRange("today", fixedNow);
    expect(range.start).toBe(localStartOfDayIso(fixedNow));
    expect(range.end).toBe("2026-03-03T15:30:00.000Z");
  });

  it("builds yesterday range", () => {
    const range = getUsageRange("yesterday", fixedNow);
    const y = new Date(fixedNow);
    y.setDate(y.getDate() - 1);
    expect(range.start).toBe(localStartOfDayIso(y));
    expect(range.end).toBe(localEndOfDayIso(y));
  });

  it("builds 7d range", () => {
    const range = getUsageRange("7d", fixedNow);
    const start = new Date(fixedNow);
    start.setDate(start.getDate() - 6);
    expect(range.start).toBe(localStartOfDayIso(start));
    expect(range.end).toBe("2026-03-03T15:30:00.000Z");
  });

  it("builds all range as null boundaries", () => {
    const range = getUsageRange("all", fixedNow);
    expect(range.start).toBeNull();
    expect(range.end).toBeNull();
  });

  it("detects includes now for bounded range", () => {
    expect(rangeIncludesNow({ start: "2026-03-03T00:00:00.000Z", end: "2026-03-03T23:59:59.999Z" }, fixedNow)).toBe(true);
    expect(rangeIncludesNow({ start: "2026-03-02T00:00:00.000Z", end: "2026-03-02T23:59:59.999Z" }, fixedNow)).toBe(false);
  });

  it("builds query from range", () => {
    const q = buildUsageQuery({
      preset: "today",
      start: "2026-03-03T00:00:00.000Z",
      end: "2026-03-03T15:30:00.000Z",
    });
    expect(q).toContain("preset=today");
    expect(q).toContain("start=2026-03-03T00%3A00%3A00.000Z");
    expect(q).toContain("end=2026-03-03T15%3A30%3A00.000Z");
  });
});
