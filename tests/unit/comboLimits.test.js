import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map();
  return {
    getApiKeyByValue: vi.fn(),
    getCombos: vi.fn(),
    getUsageByApiKey: vi.fn(),
    statsEmitter: {
      on(event, listener) {
        const eventListeners = listeners.get(event) || [];
        eventListeners.push(listener);
        listeners.set(event, eventListeners);
      },
      emit(event, payload) {
        for (const listener of listeners.get(event) || []) listener(payload);
      },
      listenerCount(event) {
        return (listeners.get(event) || []).length;
      },
    },
  };
});

vi.mock("@/lib/localDb.js", () => ({
  getApiKeyByValue: mocks.getApiKeyByValue,
  getCombos: mocks.getCombos,
}));
vi.mock("@/lib/usageDb.js", () => ({
  getUsageByApiKey: mocks.getUsageByApiKey,
  statsEmitter: mocks.statsEmitter,
}));

import { checkComboLimits, counters, getConfiguredComboUsage } from "@/sse/services/comboLimits.js";
import { invalidateComboLimitCounters } from "@/shared/utils/comboLimitCounters.js";

const limitedCombo = (id, limits = { hourly: 1_000 }) => ({ id, name: id, limits });

beforeEach(() => {
  invalidateComboLimitCounters();
  mocks.getApiKeyByValue.mockReset().mockResolvedValue({ id: "key-id", name: "User A" });
  mocks.getCombos.mockReset().mockResolvedValue([]);
  mocks.getUsageByApiKey.mockReset().mockResolvedValue(0);
  vi.useRealTimers();
});

describe("combo token limit counters", () => {
  it("allows combos without positive limits without querying usage", async () => {
    await expect(checkComboLimits("sk-user", limitedCombo("combo-free", null))).resolves.toEqual({ allowed: true });
    await expect(checkComboLimits("sk-user", limitedCombo("combo-zero", { hourly: 0 }))).resolves.toEqual({ allowed: true });

    expect(mocks.getUsageByApiKey).not.toHaveBeenCalled();
  });

  it("blocks an exhausted period and returns safe diagnostics", async () => {
    mocks.getUsageByApiKey.mockResolvedValueOnce(1_050).mockResolvedValueOnce(2_000).mockResolvedValueOnce(8_000);
    const combo = { id: "combo-kimi", name: "free_kimi", limits: { hourly: 1_000, daily: 5_000, weekly: 20_000 } };

    await expect(checkComboLimits("sk-secret", combo)).resolves.toMatchObject({
      allowed: false,
      comboId: "combo-kimi",
      comboName: "free_kimi",
      apiKeyId: "key-id",
      apiKeyName: "User A",
      period: "hourly",
      used: 1_050,
      limit: 1_000,
      retryAfter: expect.any(Number),
    });
    expect(mocks.getUsageByApiKey).toHaveBeenNthCalledWith(1, "sk-secret", expect.any(Date), { comboId: "combo-kimi" });
  });

  it("reports configured combo periods without exposing the raw key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 14, 30));
    mocks.getCombos.mockResolvedValue([
      { id: "combo-unlimited", name: "unlimited", limits: null },
      { id: "combo-kimi", name: "free_kimi", limits: { hourly: 1_000, daily: 5_000, weekly: null } },
    ]);
    mocks.getUsageByApiKey.mockResolvedValueOnce(1_050).mockResolvedValueOnce(2_000).mockResolvedValueOnce(8_000);

    const result = await getConfiguredComboUsage("sk-secret");

    expect(result).toEqual([{
      comboId: "combo-kimi",
      comboName: "free_kimi",
      hourly: { used: 1_050, limit: 1_000, blocked: true, resetAt: expect.any(String) },
      daily: { used: 2_000, limit: 5_000, blocked: false, resetAt: expect.any(String) },
      weekly: { used: 8_000, limit: null, blocked: false, resetAt: expect.any(String) },
    }]);
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  it("keeps totals independent for each key and combo pair", async () => {
    mocks.getUsageByApiKey
      .mockResolvedValueOnce(10).mockResolvedValueOnce(10).mockResolvedValueOnce(10)
      .mockResolvedValueOnce(20).mockResolvedValueOnce(20).mockResolvedValueOnce(20)
      .mockResolvedValueOnce(30).mockResolvedValueOnce(30).mockResolvedValueOnce(30);

    await checkComboLimits("sk-a", limitedCombo("combo-one", { hourly: 1_000 }));
    await checkComboLimits("sk-b", limitedCombo("combo-one", { hourly: 1_000 }));
    await checkComboLimits("sk-a", limitedCombo("combo-two", { hourly: 1_000 }));

    expect(counters.get("sk-a").get("combo-one").hourly.total).toBe(10);
    expect(counters.get("sk-b").get("combo-one").hourly.total).toBe(20);
    expect(counters.get("sk-a").get("combo-two").hourly.total).toBe(30);
  });

  it("increments every unique combo in the path regardless of metering or status", async () => {
    await checkComboLimits("sk-live", limitedCombo("combo-parent", { hourly: 1_000 }));
    await checkComboLimits("sk-live", limitedCombo("combo-child", { hourly: 1_000 }));

    mocks.statsEmitter.emit("usage", {
      apiKey: "sk-live",
      metered: false,
      status: "error",
      comboPath: [
        { id: "combo-parent", name: "BIG" },
        { id: "combo-child", name: "free_kimi" },
        { id: "combo-child", name: "free_kimi" },
      ],
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    expect(counters.get("sk-live").get("combo-parent").hourly.total).toBe(150);
    expect(counters.get("sk-live").get("combo-child").hourly.total).toBe(150);
  });

  it("reloads persisted totals after rollover and after a simulated restart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 23, 59));
    const combo = limitedCombo("combo-reload", { daily: 1_000 });
    mocks.getUsageByApiKey.mockResolvedValue(25);
    await checkComboLimits("sk-reload", combo);

    counters.clear();
    mocks.getUsageByApiKey.mockClear().mockResolvedValue(40);
    await checkComboLimits("sk-reload", combo);
    expect(counters.get("sk-reload").get("combo-reload").daily.total).toBe(40);

    mocks.getUsageByApiKey.mockClear().mockResolvedValue(0);
    vi.setSystemTime(new Date(2026, 6, 9, 0, 1));
    await checkComboLimits("sk-reload", combo);
    expect(counters.get("sk-reload").get("combo-reload").daily.total).toBe(0);
  });

  it("retries at the next real hour during the first DST fall-back occurrence", async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-01T01:30:00-04:00"));
      mocks.getUsageByApiKey.mockResolvedValue(100);

      const result = await checkComboLimits("sk-dst", limitedCombo("combo-dst", { hourly: 100 }));

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(1_800);
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it("does not lose usage emitted during loading or repopulate invalidated counters", async () => {
    const combo = limitedCombo("combo-race", { hourly: 1_000 });
    const resolvers = [];
    mocks.getUsageByApiKey.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    const pending = checkComboLimits("sk-race", combo);
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    mocks.statsEmitter.emit("usage", {
      apiKey: "sk-race",
      comboPath: [{ id: "combo-race", name: "combo-race" }],
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });
    for (const resolve of resolvers.splice(0)) resolve(0);
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    invalidateComboLimitCounters("combo-race");
    for (const resolve of resolvers) resolve(15);

    await expect(pending).resolves.toEqual({ allowed: true });
    expect(counters.get("sk-race")?.has("combo-race") || false).toBe(false);
  });
});

describe("combo limit development reload safety", () => {
  it("registers only one combo usage listener across module reloads", async () => {
    const listeners = mocks.statsEmitter.listenerCount("usage");
    vi.resetModules();
    await import("@/sse/services/comboLimits.js");
    expect(mocks.statsEmitter.listenerCount("usage")).toBe(listeners);
  });
});
