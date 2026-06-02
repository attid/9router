/**
 * Unit tests for API key token limit checking.
 *
 * Tests cover:
 *  - getUsageByApiKey() aggregation in the SQLite usage table
 *  - Calendar period helpers
 *  - In-memory counter initialization and statsEmitter increments
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";

const testEnv = vi.hoisted(() => ({
  dataDir: `/tmp/9router-key-limits-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("@/lib/dataDir.js", () => ({
  DATA_DIR: testEnv.dataDir,
  getDataDir: () => testEnv.dataDir,
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: vi.fn().mockResolvedValue([]),
  getApiKeys: vi.fn().mockResolvedValue([]),
  getProviderNodes: vi.fn().mockResolvedValue([]),
  getPricingForModel: vi.fn().mockResolvedValue(null),
  getApiKeyByValue: vi.fn().mockResolvedValue(null),
  getComboByName: vi.fn().mockResolvedValue(null),
}));

import { getAdapter } from "@/lib/db/driver.js";
import { getUsageByApiKey, saveRequestUsage, statsEmitter } from "../../src/lib/usageDb.js";
import { getHourStart, getDayStart, getWeekStart, counters } from "../../src/sse/services/keyLimits.js";
import { checkKeyLimits, getKeyUsageStats } from "../../src/sse/services/keyLimits.js";
import { getApiKeyByValue, getComboByName } from "@/lib/localDb.js";

async function resetUsage() {
  const db = await getAdapter();
  db.run("DELETE FROM usageHistory");
  db.run("DELETE FROM usageDaily");
  db.run("DELETE FROM _meta WHERE key = 'totalRequestsLifetime'");
  counters.clear();
}

async function recordUsage(entry) {
  await saveRequestUsage({
    provider: entry.provider || "test-provider",
    model: entry.model || "test-model",
    timestamp: entry.timestamp || new Date().toISOString(),
    apiKey: entry.apiKey,
    tokens: entry.tokens || {},
    requestedModel: entry.requestedModel,
    metered: entry.metered,
  });
}

beforeEach(async () => {
  await resetUsage();
  vi.mocked(getApiKeyByValue).mockResolvedValue(null);
  vi.mocked(getComboByName).mockResolvedValue(null);
});

afterAll(() => {
  fs.rmSync(testEnv.dataDir, { recursive: true, force: true });
});

describe("getUsageByApiKey", () => {
  it("is exported as a function", () => {
    expect(typeof getUsageByApiKey).toBe("function");
  });

  it("returns 0 when history is empty", async () => {
    const result = await getUsageByApiKey("key-1", new Date(0));
    expect(result).toBe(0);
  });

  it("sums prompt_tokens and completion_tokens for matching API key", async () => {
    await recordUsage({
      apiKey: "key-1",
      timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });
    await recordUsage({
      apiKey: "key-1",
      timestamp: new Date("2025-01-15T11:00:00Z").toISOString(),
      tokens: { prompt_tokens: 200, completion_tokens: 100 },
    });

    const result = await getUsageByApiKey("key-1", new Date("2025-01-01T00:00:00Z"));
    expect(result).toBe(450);
  });

  it("excludes entries for other API keys", async () => {
    await recordUsage({
      apiKey: "key-1",
      timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });
    await recordUsage({
      apiKey: "key-2",
      timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
      tokens: { prompt_tokens: 999, completion_tokens: 999 },
    });

    const result = await getUsageByApiKey("key-1", new Date("2025-01-01T00:00:00Z"));
    expect(result).toBe(150);
  });

  it("excludes entries before the since timestamp", async () => {
    await recordUsage({
      apiKey: "key-1",
      timestamp: new Date("2025-01-10T10:00:00Z").toISOString(),
      tokens: { prompt_tokens: 500, completion_tokens: 500 },
    });
    await recordUsage({
      apiKey: "key-1",
      timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const result = await getUsageByApiKey("key-1", new Date("2025-01-12T00:00:00Z"));
    expect(result).toBe(150);
  });

  it("handles entries with missing tokens gracefully", async () => {
    await recordUsage({
      apiKey: "key-1",
      timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
      tokens: {},
    });
    await recordUsage({
      apiKey: "key-1",
      timestamp: new Date("2025-01-15T11:00:00Z").toISOString(),
    });
    await recordUsage({
      apiKey: "key-1",
      timestamp: new Date("2025-01-15T12:00:00Z").toISOString(),
      tokens: { prompt_tokens: 50 },
    });

    const result = await getUsageByApiKey("key-1", new Date("2025-01-01T00:00:00Z"));
    expect(result).toBe(50);
  });

  it("excludes only entries explicitly marked unmetered when meteredOnly is true", async () => {
    await recordUsage({
      apiKey: "key-1",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });
    await recordUsage({
      apiKey: "key-1",
      requestedModel: "free_combo",
      metered: false,
      tokens: { prompt_tokens: 600, completion_tokens: 500 },
    });

    const all = await getUsageByApiKey("key-1", new Date(0));
    const meteredOnly = await getUsageByApiKey("key-1", new Date(0), { meteredOnly: true });

    expect(all).toBe(1250);
    expect(meteredOnly).toBe(150);
  });
});

describe("calendar period helpers", () => {
  it("returns start of current hour", () => {
    const date = new Date("2025-06-15T14:35:42.123Z");
    const result = getHourStart(date);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
    expect(result.getHours()).toBe(date.getHours());
  });

  it("returns midnight of current day", () => {
    const date = new Date("2025-06-15T14:35:42.123Z");
    const result = getDayStart(date);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getDate()).toBe(date.getDate());
  });

  it("returns Monday 00:00 for the current week", () => {
    expect(getWeekStart(new Date(2025, 5, 18, 14, 30, 0)).getDate()).toBe(16);
    expect(getWeekStart(new Date(2025, 5, 22, 10, 0, 0)).getDate()).toBe(16);
    expect(getWeekStart(new Date(2025, 5, 16, 10, 0, 0)).getDate()).toBe(16);
  });
});

describe("checkKeyLimits", () => {
  it("allows when no key provided", async () => {
    const result = await checkKeyLimits(null);
    expect(result).toEqual({ allowed: true });
  });

  it("allows when key has no limits", async () => {
    vi.mocked(getApiKeyByValue).mockResolvedValue({ key: "sk-test", limits: null });
    const result = await checkKeyLimits("sk-test");
    expect(result).toEqual({ allowed: true });
  });

  it("allows when limits are all zero", async () => {
    vi.mocked(getApiKeyByValue).mockResolvedValue({
      key: "sk-test",
      limits: { hourly: 0, daily: 0, weekly: 0 },
    });
    const result = await checkKeyLimits("sk-test");
    expect(result).toEqual({ allowed: true });
  });

  it("blocks when hourly limit exceeded", async () => {
    await recordUsage({
      apiKey: "sk-test",
      tokens: { prompt_tokens: 600, completion_tokens: 500 },
    });
    vi.mocked(getApiKeyByValue).mockResolvedValue({
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
    await recordUsage({
      apiKey: "sk-test",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });
    vi.mocked(getApiKeyByValue).mockResolvedValue({
      key: "sk-test",
      limits: { hourly: 1000, daily: 0, weekly: 0 },
    });

    const result = await checkKeyLimits("sk-test");
    expect(result).toEqual({ allowed: true });
  });

  it("counts legacy underlying usage for combo-only API keys when entries are not explicitly unmetered", async () => {
    await recordUsage({
      apiKey: "sk-test",
      model: "moonshot/kimi-k2.5",
      provider: "moonshot",
      tokens: { prompt_tokens: 600, completion_tokens: 500 },
    });
    vi.mocked(getApiKeyByValue).mockResolvedValue({
      key: "sk-test",
      allowedModels: ["free_kimi"],
      limits: { hourly: 1000, daily: 0, weekly: 0 },
    });

    const result = await checkKeyLimits("sk-test");
    const stats = await getKeyUsageStats("sk-test");

    expect(result.allowed).toBe(false);
    expect(stats.hourly.used).toBe(1100);
  });

  it("does not count usage entries explicitly marked as unmetered", async () => {
    await recordUsage({
      apiKey: "sk-test",
      model: "moonshot/kimi-k2.5",
      provider: "moonshot",
      requestedModel: "free_kimi",
      metered: false,
      tokens: { prompt_tokens: 600, completion_tokens: 500 },
    });
    vi.mocked(getApiKeyByValue).mockResolvedValue({
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
    vi.mocked(getApiKeyByValue).mockResolvedValue({
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

  it("ignores update for untracked key", () => {
    statsEmitter.emit("update", {
      apiKey: "sk-unknown",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });
    expect(counters.has("sk-unknown")).toBe(false);
  });

  it("increments tracked combo-only key from unmarked underlying usage", async () => {
    vi.mocked(getApiKeyByValue).mockResolvedValue({
      key: "sk-test",
      allowedModels: ["free_kimi"],
      limits: { hourly: 10000, daily: 0, weekly: 0 },
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
    vi.mocked(getApiKeyByValue).mockResolvedValue({
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
