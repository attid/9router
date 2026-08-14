import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map();
  return {
    getApiKeyByValue: vi.fn(),
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

vi.mock("@/lib/localDb.js", () => ({ getApiKeyByValue: mocks.getApiKeyByValue }));
vi.mock("@/lib/usageDb.js", () => ({
  getUsageByApiKey: mocks.getUsageByApiKey,
  statsEmitter: mocks.statsEmitter,
}));

import {
  checkKeyLimits,
  counters,
  getDayStart,
  getHourStart,
  getKeyUsageStats,
  getWeekStart,
} from "@/sse/services/keyLimits.js";
import { invalidateKeyLimitCounters } from "@/shared/utils/keyLimitCounters.js";

beforeEach(() => {
  counters.clear();
  mocks.getApiKeyByValue.mockReset().mockResolvedValue(null);
  mocks.getUsageByApiKey.mockReset().mockResolvedValue(0);
  vi.useRealTimers();
});

describe("calendar periods", () => {
  it("uses local clock-hour and day boundaries", () => {
    const date = new Date(2026, 6, 8, 14, 35, 42, 123);
    expect(getHourStart(date)).toEqual(new Date(2026, 6, 8, 14, 0, 0, 0));
    expect(getDayStart(date)).toEqual(new Date(2026, 6, 8, 0, 0, 0, 0));
  });

  it("uses Monday at local midnight for weekly limits", () => {
    expect(getWeekStart(new Date(2026, 6, 8, 14))).toEqual(new Date(2026, 6, 6, 0, 0, 0, 0));
    expect(getWeekStart(new Date(2026, 6, 12, 23))).toEqual(new Date(2026, 6, 6, 0, 0, 0, 0));
    expect(getWeekStart(new Date(2026, 6, 6, 1))).toEqual(new Date(2026, 6, 6, 0, 0, 0, 0));
  });

  it("preserves the active offset occurrence during a DST fall-back hour", () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const firstOccurrence = new Date("2026-11-01T01:30:00-04:00");
      const secondOccurrence = new Date("2026-11-01T01:30:00-05:00");

      expect(getHourStart(firstOccurrence).toISOString()).toBe("2026-11-01T05:00:00.000Z");
      expect(getHourStart(secondOccurrence).toISOString()).toBe("2026-11-01T06:00:00.000Z");
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

describe("hybrid API-key counters", () => {
  it("initializes every period from persisted metered usage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 14, 35));
    mocks.getApiKeyByValue.mockResolvedValue({ limits: { hourly: 1_000, daily: 5_000, weekly: 20_000 } });
    mocks.getUsageByApiKey.mockResolvedValueOnce(100).mockResolvedValueOnce(900).mockResolvedValueOnce(4_000);

    await expect(getKeyUsageStats("sk-init")).resolves.toEqual({
      hourly: { used: 100, limit: 1_000 },
      daily: { used: 900, limit: 5_000 },
      weekly: { used: 4_000, limit: 20_000 },
    });
    expect(mocks.getUsageByApiKey).toHaveBeenCalledTimes(3);
    expect(mocks.getUsageByApiKey).toHaveBeenNthCalledWith(1, "sk-init", new Date(2026, 6, 8, 14), { meteredOnly: true });
    expect(mocks.getUsageByApiKey).toHaveBeenNthCalledWith(3, "sk-init", new Date(2026, 6, 6), { meteredOnly: true });
  });

  it("increments tracked periods immediately but ignores explicitly unmetered usage", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({ limits: { hourly: 1_000 } });
    await getKeyUsageStats("sk-live");

    mocks.statsEmitter.emit("usage", {
      apiKey: "sk-live",
      tokens: { prompt_tokens: 100, completion_tokens: 50, cached_tokens: 25 },
    });
    mocks.statsEmitter.emit("usage", {
      apiKey: "sk-live",
      metered: false,
      tokens: { prompt_tokens: 600, completion_tokens: 500 },
    });

    expect(counters.get("sk-live").hourly.total).toBe(150);
    expect(counters.get("sk-live").daily.total).toBe(150);
    expect(counters.get("sk-live").weekly.total).toBe(150);
  });

  it("reloads all persisted periods after a calendar rollover", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 23, 59));
    mocks.getApiKeyByValue.mockResolvedValue({ limits: { daily: 1_000 } });
    mocks.getUsageByApiKey.mockResolvedValue(25);
    await getKeyUsageStats("sk-rollover");

    mocks.getUsageByApiKey.mockClear().mockResolvedValue(0);
    vi.setSystemTime(new Date(2026, 6, 9, 0, 1));
    await getKeyUsageStats("sk-rollover");

    expect(mocks.getUsageByApiKey).toHaveBeenCalledTimes(3);
    expect(counters.get("sk-rollover").daily.total).toBe(0);
  });

  it("does not lose usage emitted while persisted counters are loading", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({ limits: { hourly: 1_000 } });
    const resolvers = [];
    mocks.getUsageByApiKey
      .mockImplementationOnce(() => new Promise((resolve) => resolvers.push(resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => resolvers.push(resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => resolvers.push(resolve)))
      .mockResolvedValue(15);

    const pending = getKeyUsageStats("sk-loading-event");
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    mocks.statsEmitter.emit("usage", {
      apiKey: "sk-loading-event",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });
    for (const resolve of resolvers) resolve(0);

    await expect(pending).resolves.toMatchObject({ hourly: { used: 15 } });
    expect(mocks.getUsageByApiKey).toHaveBeenCalledTimes(6);
  });

  it("does not repopulate a counter invalidated during an in-flight load", async () => {
    mocks.getApiKeyByValue.mockResolvedValue({ limits: { hourly: 1_000 } });
    const resolvers = [];
    mocks.getUsageByApiKey.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    const pending = getKeyUsageStats("sk-invalidated-load");
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    invalidateKeyLimitCounters("sk-invalidated-load");
    for (const resolve of resolvers) resolve(20);

    await expect(pending).resolves.toMatchObject({ hourly: { used: 20 } });
    expect(counters.has("sk-invalidated-load")).toBe(false);
  });
});

describe("limit enforcement", () => {
  it("allows missing keys and keys without positive limits without loading usage", async () => {
    await expect(checkKeyLimits(null)).resolves.toEqual({ allowed: true });
    mocks.getApiKeyByValue.mockResolvedValue({ limits: { hourly: null, daily: 0, weekly: null } });
    await expect(checkKeyLimits("sk-unlimited")).resolves.toEqual({ allowed: true });
    expect(mocks.getUsageByApiKey).not.toHaveBeenCalled();
  });

  it.each([
    ["hourly", { hourly: 100 }, [100, 100, 100], 3_600],
    ["daily", { daily: 500 }, [10, 500, 500], 86_400],
    ["weekly", { weekly: 900 }, [10, 20, 900], 7 * 86_400],
  ])("blocks an exhausted %s period with a bounded retry delay", async (period, limits, totals, maxRetry) => {
    mocks.getApiKeyByValue.mockResolvedValue({ limits });
    mocks.getUsageByApiKey.mockResolvedValueOnce(totals[0]).mockResolvedValueOnce(totals[1]).mockResolvedValueOnce(totals[2]);

    const result = await checkKeyLimits(`sk-${period}`);

    expect(result.allowed).toBe(false);
    expect(result.error).toContain(period);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(maxRetry);
  });

  it("retries at the next real hour during the first DST fall-back occurrence", async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-01T01:30:00-04:00"));
      mocks.getApiKeyByValue.mockResolvedValue({ limits: { hourly: 100 } });
      mocks.getUsageByApiKey.mockResolvedValue(100);

      const result = await checkKeyLimits("sk-fall-back");

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(1_800);
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

describe("development reload safety", () => {
  it("registers only one live usage listener across module reloads", async () => {
    expect(mocks.statsEmitter.listenerCount("usage")).toBe(1);
    vi.resetModules();
    await import("@/sse/services/keyLimits.js");
    expect(mocks.statsEmitter.listenerCount("usage")).toBe(1);
  });
});
