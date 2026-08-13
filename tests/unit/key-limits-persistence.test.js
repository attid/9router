import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testEnv = vi.hoisted(() => ({
  dataDir: `/tmp/9router-key-limits-persistence-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));

vi.mock("@/lib/dataDir.js", () => ({
  DATA_DIR: testEnv.dataDir,
  getDataDir: () => testEnv.dataDir,
}));

let db;

beforeAll(async () => {
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  fs.rmSync(testEnv.dataDir, { recursive: true, force: true });
});

describe("API-key limits persistence", () => {
  it("creates, reads by value, partially updates, and clears calendar limits", async () => {
    const key = await db.createApiKey("limited", "machine-test", {
      hourly: 1_000,
      daily: 10_000,
      weekly: 50_000,
    });

    expect(key.limits).toEqual({ hourly: 1_000, daily: 10_000, weekly: 50_000 });
    await expect(db.getApiKeyByValue(key.key)).resolves.toMatchObject({
      id: key.id,
      limits: { hourly: 1_000, daily: 10_000, weekly: 50_000 },
    });

    global._apiKeyLimitCounters = new Map([[key.key, { hourly: { periodStart: 1, total: 1 } }]]);
    await db.updateApiKey(key.id, { limits: { daily: 20_000 } });
    expect(global._apiKeyLimitCounters.has(key.key)).toBe(false);
    await expect(db.getApiKeyById(key.id)).resolves.toMatchObject({
      limits: { hourly: 1_000, daily: 20_000, weekly: 50_000 },
    });

    global._apiKeyLimitCounters.set(key.key, { daily: { periodStart: 2, total: 2 } });
    await db.updateApiKey(key.id, { limits: null });
    expect(global._apiKeyLimitCounters.has(key.key)).toBe(false);
    await expect(db.getApiKeyById(key.id)).resolves.toMatchObject({ limits: null });
  });

  it("preserves limits, free-combo flags, and complete usage through export/import", async () => {
    const key = await db.createApiKey("roundtrip", "machine-test", { hourly: 321 });
    const combo = await db.createCombo({
      name: "free_roundtrip",
      models: ["openai/gpt-test"],
      isFree: true,
      limits: { hourly: 111, daily: 2_222, weekly: 33_333 },
    });
    const timestamp = "2026-07-10T12:00:00.000Z";
    await db.saveRequestUsage({
      timestamp,
      startedAt: timestamp,
      provider: "openai",
      model: "free-roundtrip-model",
      apiKey: key.key,
      requestedModel: combo.name,
      metered: false,
      comboPath: [
        { id: "combo-parent", name: "BIG" },
        { id: combo.id, name: combo.name },
      ],
      tokens: { prompt_tokens: 123, completion_tokens: 45, cached_tokens: 67 },
    });
    const snapshot = await db.exportDb();

    expect(snapshot.apiKeys.find((item) => item.id === key.id)?.limits).toEqual({ hourly: 321, daily: null, weekly: null });
    expect(snapshot.combos.find((item) => item.id === combo.id)?.isFree).toBe(true);
    expect(snapshot.combos.find((item) => item.id === combo.id)?.limits).toEqual({
      hourly: 111,
      daily: 2_222,
      weekly: 33_333,
    });
    expect(snapshot.usageHistory.find((item) => item.timestamp === timestamp)).toMatchObject({
      apiKey: key.key,
      tokens: { prompt_tokens: 123, completion_tokens: 45, cached_tokens: 67 },
      meta: {
        requestedModel: combo.name,
        metered: false,
        startedAt: timestamp,
        comboPath: [
          { id: "combo-parent", name: "BIG" },
          { id: combo.id, name: combo.name },
        ],
      },
    });

    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    adapter.run("DELETE FROM usageHistory WHERE timestamp = ?", [timestamp]);
    await db.importDb(snapshot);
    await expect(db.getApiKeyById(key.id)).resolves.toMatchObject({ limits: { hourly: 321, daily: null, weekly: null } });
    await expect(db.getComboById(combo.id)).resolves.toMatchObject({
      isFree: true,
      limits: { hourly: 111, daily: 2_222, weekly: 33_333 },
    });
    await expect(db.getUsageByApiKey(key.key, new Date(0))).resolves.toBe(168);
    await expect(db.getUsageByApiKey(key.key, new Date(0), { meteredOnly: true })).resolves.toBe(0);
    const restored = adapter.get("SELECT tokens, meta FROM usageHistory WHERE timestamp = ?", [timestamp]);
    expect(JSON.parse(restored.tokens)).toMatchObject({ cached_tokens: 67 });
    expect(JSON.parse(restored.meta)).toEqual({
      requestedModel: combo.name,
      metered: false,
      startedAt: timestamp,
      comboPath: [
        { id: "combo-parent", name: "BIG" },
        { id: combo.id, name: combo.name },
      ],
    });
  });

  it("rejects legacy imports that restore positive limits without usage history", async () => {
    await expect(db.importDb({
      settings: {},
      apiKeys: [{
        id: "legacy-limited",
        key: "sk-legacy-limited",
        machineId: "machine-test",
        limits: { hourly: 100 },
      }],
    })).rejects.toThrow(/usage history/i);
  });
});

describe("free-combo metering persistence", () => {
  it("indexes API-key period lookups used by the limit counters", async () => {
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    const indexes = adapter.all("PRAGMA index_list(usageHistory)").map((row) => row.name);
    expect(indexes).toContain("idx_uh_api_key_ts");
  });

  it("preserves isFree when unrelated combo fields are updated", async () => {
    const combo = await db.createCombo({
      name: "free_preserved",
      models: ["provider/one"],
      isFree: true,
      limits: { hourly: 100, daily: 1_000, weekly: 5_000 },
    });
    await db.updateCombo(combo.id, { models: ["provider/two"] });

    await expect(db.getComboById(combo.id)).resolves.toMatchObject({
      models: ["provider/two"],
      isFree: true,
      limits: { hourly: 100, daily: 1_000, weekly: 5_000 },
    });
  });

  it("partially updates and clears combo token limits independently of isFree", async () => {
    const combo = await db.createCombo({
      name: "combo_limit_updates",
      models: ["provider/one"],
      isFree: false,
      limits: { hourly: 100, daily: 1_000, weekly: 5_000 },
    });

    await db.updateCombo(combo.id, { limits: { daily: 2_000 } });
    await expect(db.getComboById(combo.id)).resolves.toMatchObject({
      isFree: false,
      limits: { hourly: 100, daily: 2_000, weekly: 5_000 },
    });

    await db.updateCombo(combo.id, { limits: null });
    await expect(db.getComboById(combo.id)).resolves.toMatchObject({
      isFree: false,
      limits: null,
    });
  });

  it("stores a complete limit shape when partially updating a legacy combo", async () => {
    const combo = await db.createCombo({
      name: "legacy_combo_limit_update",
      models: ["provider/one"],
    });

    await db.updateCombo(combo.id, { limits: { daily: 2_000 } });

    await expect(db.getComboById(combo.id)).resolves.toMatchObject({
      limits: { hourly: null, daily: 2_000, weekly: null },
    });
  });

  it("invalidates a changed combo limit for every cached API key", async () => {
    const combo = await db.createCombo({
      name: "combo_cache_invalidation",
      models: ["provider/one"],
      limits: { hourly: 100 },
    });
    global._comboLimitCounters = new Map([
      ["sk-one", new Map([[combo.id, { hourly: { total: 10 } }], ["other-combo", { hourly: { total: 20 } }]])],
      ["sk-two", new Map([[combo.id, { hourly: { total: 30 } }]])],
    ]);

    await db.updateCombo(combo.id, { limits: { hourly: 200 } });

    expect(global._comboLimitCounters.get("sk-one").has(combo.id)).toBe(false);
    expect(global._comboLimitCounters.get("sk-one").has("other-combo")).toBe(true);
    expect(global._comboLimitCounters.has("sk-two")).toBe(false);
  });

  it("keeps free usage in reports while metered totals exclude it", async () => {
    const apiKey = "sk-metered-report-test";
    await db.saveRequestUsage({
      provider: "openai",
      model: "paid-model",
      apiKey,
      tokens: { prompt_tokens: 100, completion_tokens: 50, cached_tokens: 25 },
    });
    await db.saveRequestUsage({
      provider: "openai",
      model: "free-model",
      requestedModel: "free_combo",
      metered: false,
      apiKey,
      tokens: { prompt_tokens: 600, completion_tokens: 500, cached_tokens: 200 },
    });

    await expect(db.getUsageByApiKey(apiKey, new Date(0))).resolves.toBe(1_250);
    await expect(db.getUsageByApiKey(apiKey, new Date(0), { meteredOnly: true })).resolves.toBe(150);

    const history = await db.getUsageHistory({ model: "free-model" });
    expect(history).toHaveLength(1);
    expect(history[0]).not.toHaveProperty("apiKey");
    expect(history[0].apiKeyMasked).toBe("sk-meter***");
    expect(history[0].tokens.cached_tokens).toBe(200);

    const stats = await db.getUsageStats("24h");
    expect(stats.byModel["free-model (openai)"]).toMatchObject({
      promptTokens: 600,
      completionTokens: 500,
      cachedTokens: 200,
    });
    const keyRows = Object.values(stats.byApiKey).filter((row) => row.apiKeyMasked === "sk-meter***");
    expect(keyRows.reduce((sum, row) => sum + row.promptTokens, 0)).toBe(700);
    expect(keyRows.reduce((sum, row) => sum + row.completionTokens, 0)).toBe(550);
  });

  it("scopes combo usage by stable path IDs while ignoring legacy rows", async () => {
    const apiKey = "sk-combo-scope-test";
    await db.saveRequestUsage({
      timestamp: "2026-07-10T12:00:00.000Z",
      provider: "openai",
      model: "nested-model",
      apiKey,
      metered: false,
      status: "error",
      comboPath: [
        { id: "combo-parent", name: "BIG" },
        { id: "combo-child", name: "free_kimi" },
      ],
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });
    await db.saveRequestUsage({
      timestamp: "2026-07-10T12:01:00.000Z",
      provider: "openai",
      model: "legacy-model",
      apiKey,
      tokens: { prompt_tokens: 900, completion_tokens: 100 },
    });

    await expect(db.getUsageByApiKey(apiKey, new Date(0), { comboId: "combo-parent" })).resolves.toBe(150);
    await expect(db.getUsageByApiKey(apiKey, new Date(0), { comboId: "combo-child" })).resolves.toBe(150);
    await expect(db.getUsageByApiKey(apiKey, new Date(0), { comboId: "combo-other" })).resolves.toBe(0);
    await expect(db.getUsageByApiKey(apiKey, new Date(0))).resolves.toBe(1_150);
  });

  it("emits exactly one immediate usage event only after a new row is inserted", async () => {
    const events = [];
    const listener = (entry) => events.push(entry);
    db.statsEmitter.on("usage", listener);
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      provider: "openai",
      model: "event-model",
      apiKey: "sk-event-test",
      metered: false,
      tokens: { prompt_tokens: 5, completion_tokens: 7 },
    };

    await db.saveRequestUsage({ ...entry });
    await db.saveRequestUsage({ ...entry });
    db.statsEmitter.off("usage", listener);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ apiKey: "sk-event-test", metered: false });
  });
});
