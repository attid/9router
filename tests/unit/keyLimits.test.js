/**
 * Unit tests for API key token limit checking.
 *
 * Tests cover:
 *  - getUsageByApiKey() aggregation through the SQLite-backed usage API
 *  - Calendar period helpers
 *  - In-memory counter initialization and statsEmitter increments
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

function resetDbGlobals() {
  delete global._dbAdapter;
  delete global._pendingRequests;
  delete global._lastErrorProvider;
  delete global._statsEmitter;
  delete global._pendingTimers;
  delete global._recentRing;
  delete global._connectionMapCache;
}

async function loadModules() {
  vi.resetModules();
  resetDbGlobals();
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "key-limits-"));

  const getApiKeyByValue = vi.fn().mockResolvedValue(null);
  const getComboByName = vi.fn().mockResolvedValue(null);
  vi.doMock("../../src/lib/localDb.js", () => ({ getApiKeyByValue, getComboByName }));

  const usageDb = await import("../../src/lib/usageDb.js");
  const keyLimits = await import("../../src/sse/services/keyLimits.js");

  keyLimits.counters.clear();

  return { ...usageDb, ...keyLimits, getApiKeyByValue, getComboByName };
}

async function saveUsage(saveRequestUsage, apiKey, timestamp, tokens, model = "test-model") {
  await saveRequestUsage({
    apiKey,
    timestamp: timestamp instanceof Date ? timestamp.toISOString() : timestamp,
    provider: "test-provider",
    model,
    tokens,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  resetDbGlobals();

  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }
});

describe("getUsageByApiKey", () => {
  it("is exported as a function", async () => {
    const { getUsageByApiKey } = await loadModules();
    expect(typeof getUsageByApiKey).toBe("function");
  });

  it("returns 0 when history is empty", async () => {
    const { getUsageByApiKey } = await loadModules();
    const result = await getUsageByApiKey("key-1", new Date(0));
    expect(result).toBe(0);
  });

  it("sums prompt_tokens and completion_tokens for matching API key", async () => {
    const { saveRequestUsage, getUsageByApiKey } = await loadModules();
    await saveUsage(saveRequestUsage, "key-1", "2025-01-15T10:00:00Z", { prompt_tokens: 100, completion_tokens: 50 });
    await saveUsage(saveRequestUsage, "key-1", "2025-01-15T11:00:00Z", { prompt_tokens: 200, completion_tokens: 100 });

    const result = await getUsageByApiKey("key-1", new Date("2025-01-01T00:00:00Z"));
    expect(result).toBe(450);
  });

  it("excludes entries for other API keys", async () => {
    const { saveRequestUsage, getUsageByApiKey } = await loadModules();
    await saveUsage(saveRequestUsage, "key-1", "2025-01-15T10:00:00Z", { prompt_tokens: 100, completion_tokens: 50 });
    await saveUsage(saveRequestUsage, "key-2", "2025-01-15T10:00:00Z", { prompt_tokens: 999, completion_tokens: 999 });

    const result = await getUsageByApiKey("key-1", new Date("2025-01-01T00:00:00Z"));
    expect(result).toBe(150);
  });

  it("excludes entries before the since timestamp", async () => {
    const { saveRequestUsage, getUsageByApiKey } = await loadModules();
    await saveUsage(saveRequestUsage, "key-1", "2025-01-10T10:00:00Z", { prompt_tokens: 500, completion_tokens: 500 });
    await saveUsage(saveRequestUsage, "key-1", "2025-01-15T10:00:00Z", { prompt_tokens: 100, completion_tokens: 50 });

    const result = await getUsageByApiKey("key-1", new Date("2025-01-12T00:00:00Z"));
    expect(result).toBe(150);
  });

  it("handles entries with missing tokens gracefully", async () => {
    const { saveRequestUsage, getUsageByApiKey } = await loadModules();
    await saveUsage(saveRequestUsage, "key-1", "2025-01-15T10:00:00Z", {});
    await saveUsage(saveRequestUsage, "key-1", "2025-01-15T11:00:00Z");
    await saveUsage(saveRequestUsage, "key-1", "2025-01-15T12:00:00Z", { prompt_tokens: 50 });

    const result = await getUsageByApiKey("key-1", new Date("2025-01-01T00:00:00Z"));
    expect(result).toBe(50);
  });
});

describe("calendar period helpers", () => {
  it("returns start of current hour", async () => {
    const { getHourStart } = await loadModules();
    const date = new Date("2025-06-15T14:35:42.123Z");
    const result = getHourStart(date);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
    expect(result.getHours()).toBe(date.getHours());
  });

  it("returns midnight of current day", async () => {
    const { getDayStart } = await loadModules();
    const date = new Date("2025-06-15T14:35:42.123Z");
    const result = getDayStart(date);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getDate()).toBe(date.getDate());
  });

  it("returns Monday 00:00 for a Wednesday", async () => {
    const { getWeekStart } = await loadModules();
    const date = new Date(2025, 5, 18, 14, 30, 0);
    const result = getWeekStart(date);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(16);
    expect(result.getHours()).toBe(0);
  });

  it("returns Monday 00:00 for a Sunday", async () => {
    const { getWeekStart } = await loadModules();
    const date = new Date(2025, 5, 22, 10, 0, 0);
    const result = getWeekStart(date);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(16);
    expect(result.getHours()).toBe(0);
  });

  it("returns same day for a Monday", async () => {
    const { getWeekStart } = await loadModules();
    const date = new Date(2025, 5, 16, 10, 0, 0);
    const result = getWeekStart(date);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(16);
  });
});

describe("checkKeyLimits", () => {
  it("allows when no key provided", async () => {
    const { checkKeyLimits } = await loadModules();
    const result = await checkKeyLimits(null);
    expect(result).toEqual({ allowed: true });
  });

  it("allows when key has no limits", async () => {
    const { checkKeyLimits, getApiKeyByValue } = await loadModules();
    getApiKeyByValue.mockResolvedValue({ key: "sk-test", limits: null });

    const result = await checkKeyLimits("sk-test");
    expect(result).toEqual({ allowed: true });
  });

  it("allows when limits are all zero", async () => {
    const { checkKeyLimits, getApiKeyByValue } = await loadModules();
    getApiKeyByValue.mockResolvedValue({
      key: "sk-test",
      limits: { hourly: 0, daily: 0, weekly: 0 },
    });

    const result = await checkKeyLimits("sk-test");
    expect(result).toEqual({ allowed: true });
  });

  it("blocks when hourly limit exceeded", async () => {
    const { saveRequestUsage, checkKeyLimits, getApiKeyByValue } = await loadModules();
    await saveUsage(saveRequestUsage, "sk-test", new Date(), { prompt_tokens: 600, completion_tokens: 500 });
    getApiKeyByValue.mockResolvedValue({
      key: "sk-test",
      limits: { hourly: 1000, daily: 0, weekly: 0 },
    });

    const result = await checkKeyLimits("sk-test");
    expect(result.allowed).toBe(false);
    expect(result.error).toContain("hourly");
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(3600);
  });

  it("allows when under hourly limit", async () => {
    const { saveRequestUsage, checkKeyLimits, getApiKeyByValue } = await loadModules();
    await saveUsage(saveRequestUsage, "sk-test", new Date(), { prompt_tokens: 100, completion_tokens: 50 });
    getApiKeyByValue.mockResolvedValue({
      key: "sk-test",
      limits: { hourly: 1000, daily: 0, weekly: 0 },
    });

    const result = await checkKeyLimits("sk-test");
    expect(result).toEqual({ allowed: true });
  });

  it("counts legacy underlying usage for combo-only API keys when entries are not explicitly unmetered", async () => {
    const { saveRequestUsage, checkKeyLimits, getKeyUsageStats, getApiKeyByValue, getComboByName } = await loadModules();
    await saveUsage(
      saveRequestUsage,
      "sk-test",
      new Date(),
      { prompt_tokens: 600, completion_tokens: 500 },
      "moonshot/kimi-k2.5"
    );
    getApiKeyByValue.mockResolvedValue({
      key: "sk-test",
      allowedModels: ["free_kimi"],
      limits: { hourly: 1000, daily: 0, weekly: 0 },
    });
    getComboByName.mockImplementation(async (name) => {
      if (name === "free_kimi") {
        return { name: "free_kimi", models: ["moonshot/kimi-k2.5"] };
      }
      return null;
    });

    const result = await checkKeyLimits("sk-test");
    const stats = await getKeyUsageStats("sk-test");

    expect(result.allowed).toBe(false);
    expect(stats.hourly.used).toBe(1100);
  });

  it("does not count usage entries explicitly marked as unmetered", async () => {
    const { saveRequestUsage, checkKeyLimits, getKeyUsageStats, getApiKeyByValue } = await loadModules();
    await saveRequestUsage({
      apiKey: "sk-test",
      timestamp: new Date().toISOString(),
      provider: "moonshot",
      model: "moonshot/kimi-k2.5",
      requestedModel: "free_kimi",
      metered: false,
      tokens: { prompt_tokens: 600, completion_tokens: 500 },
    });
    getApiKeyByValue.mockResolvedValue({
      key: "sk-test",
      allowedModels: ["free_kimi"],
      limits: { hourly: 1000, daily: 0, weekly: 0 },
    });

    const result = await checkKeyLimits("sk-test");
    const stats = await getKeyUsageStats("sk-test");

    expect(result).toEqual({ allowed: true });
    expect(stats.hourly.used).toBe(0);
  });
});

describe("statsEmitter increment", () => {
  it("increments counter on update event for tracked key", async () => {
    const { checkKeyLimits, counters, statsEmitter, getApiKeyByValue } = await loadModules();
    getApiKeyByValue.mockResolvedValue({
      key: "sk-test",
      limits: { hourly: 10000, daily: 0, weekly: 0 },
    });
    await checkKeyLimits("sk-test");

    const entry = counters.get("sk-test");
    const before = entry.hourly.total;

    statsEmitter.emit("update", {
      apiKey: "sk-test",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    expect(entry.hourly.total).toBe(before + 150);
  });

  it("ignores update for untracked key", async () => {
    const { counters, statsEmitter } = await loadModules();

    statsEmitter.emit("update", {
      apiKey: "sk-unknown",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    expect(counters.has("sk-unknown")).toBe(false);
  });

  it("increments tracked combo-only key from unmarked underlying usage", async () => {
    const { checkKeyLimits, counters, statsEmitter, getApiKeyByValue, getComboByName } = await loadModules();
    getApiKeyByValue.mockResolvedValue({
      key: "sk-test",
      allowedModels: ["free_kimi"],
      limits: { hourly: 10000, daily: 0, weekly: 0 },
    });
    getComboByName.mockImplementation(async (name) => {
      if (name === "free_kimi") {
        return { name: "free_kimi", models: ["moonshot/kimi-k2.5"] };
      }
      return null;
    });
    await checkKeyLimits("sk-test");

    const entry = counters.get("sk-test");
    statsEmitter.emit("update", {
      apiKey: "sk-test",
      model: "moonshot/kimi-k2.5",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    expect(entry.hourly.total).toBe(150);
  });

  it("does not increment tracked key from usage explicitly marked as unmetered", async () => {
    const { checkKeyLimits, counters, statsEmitter, getApiKeyByValue } = await loadModules();
    getApiKeyByValue.mockResolvedValue({
      key: "sk-test",
      allowedModels: ["free_kimi"],
      limits: { hourly: 10000, daily: 0, weekly: 0 },
    });
    await checkKeyLimits("sk-test");

    const entry = counters.get("sk-test");
    statsEmitter.emit("update", {
      apiKey: "sk-test",
      model: "moonshot/kimi-k2.5",
      requestedModel: "free_kimi",
      metered: false,
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    expect(entry.hourly.total).toBe(0);
  });
});
