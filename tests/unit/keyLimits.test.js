/**
 * Unit tests for API key token limit checking.
 *
 * Tests cover:
 *  - getUsageByApiKey() — aggregation of tokens by API key within a time window
 *  - Calendar period helpers — getHourStart, getDayStart, getWeekStart
 *  - In-memory counter logic — initialization, period rollover, increment via event
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock lowdb to avoid file system access
vi.mock("lowdb", () => {
  class Low {
    constructor(adapter, defaultData) {
      this.data = defaultData || { history: [] };
    }
    async read() {}
    async write() {}
  }
  return { Low };
});

vi.mock("lowdb/node", () => ({
  JSONFile: vi.fn(),
}));

// Mock fs to avoid file system side effects
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => "{}"),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

// Mock localDb to avoid transitive imports
vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: vi.fn().mockResolvedValue([]),
  getApiKeys: vi.fn().mockResolvedValue([]),
  getProviderNodes: vi.fn().mockResolvedValue([]),
  getPricingForModel: vi.fn().mockResolvedValue(null),
  getApiKeyByValue: vi.fn().mockResolvedValue(null),
}));

// Mock requestDetailsDb to avoid SQLite dependency
vi.mock("../../src/lib/requestDetailsDb.js", () => ({
  saveRequestDetail: vi.fn(),
  getRequestDetails: vi.fn(),
  getRequestDetailById: vi.fn(),
}));

import { getUsageByApiKey, getUsageDb } from "../../src/lib/usageDb.js";
import { getHourStart, getDayStart, getWeekStart, counters } from "../../src/sse/services/keyLimits.js";
import { checkKeyLimits, getKeyUsageStats } from "../../src/sse/services/keyLimits.js";
import { getApiKeyByValue } from "@/lib/localDb.js";
import { statsEmitter } from "../../src/lib/usageDb.js";

// --- getUsageByApiKey tests ---

describe("getUsageByApiKey", () => {
  beforeEach(async () => {
    const db = await getUsageDb();
    db.data.history = [];
  });

  it("is exported as a function", () => {
    expect(typeof getUsageByApiKey).toBe("function");
  });

  it("returns 0 when history is empty", async () => {
    const result = await getUsageByApiKey("key-1", new Date(0));
    expect(result).toBe(0);
  });

  it("sums prompt_tokens and completion_tokens for matching API key", async () => {
    const db = await getUsageDb();
    db.data.history = [
      {
        apiKey: "key-1",
        timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
        tokens: { prompt_tokens: 100, completion_tokens: 50 },
      },
      {
        apiKey: "key-1",
        timestamp: new Date("2025-01-15T11:00:00Z").toISOString(),
        tokens: { prompt_tokens: 200, completion_tokens: 100 },
      },
    ];

    const result = await getUsageByApiKey("key-1", new Date("2025-01-01T00:00:00Z"));
    expect(result).toBe(450); // 100+50 + 200+100
  });

  it("excludes entries for other API keys", async () => {
    const db = await getUsageDb();
    db.data.history = [
      {
        apiKey: "key-1",
        timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
        tokens: { prompt_tokens: 100, completion_tokens: 50 },
      },
      {
        apiKey: "key-2",
        timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
        tokens: { prompt_tokens: 999, completion_tokens: 999 },
      },
    ];

    const result = await getUsageByApiKey("key-1", new Date("2025-01-01T00:00:00Z"));
    expect(result).toBe(150); // only key-1: 100+50
  });

  it("excludes entries before the since timestamp", async () => {
    const db = await getUsageDb();
    db.data.history = [
      {
        apiKey: "key-1",
        timestamp: new Date("2025-01-10T10:00:00Z").toISOString(),
        tokens: { prompt_tokens: 500, completion_tokens: 500 },
      },
      {
        apiKey: "key-1",
        timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
        tokens: { prompt_tokens: 100, completion_tokens: 50 },
      },
    ];

    const result = await getUsageByApiKey("key-1", new Date("2025-01-12T00:00:00Z"));
    expect(result).toBe(150); // only the entry after Jan 12
  });

  it("handles entries with missing tokens gracefully", async () => {
    const db = await getUsageDb();
    db.data.history = [
      {
        apiKey: "key-1",
        timestamp: new Date("2025-01-15T10:00:00Z").toISOString(),
        tokens: {},
      },
      {
        apiKey: "key-1",
        timestamp: new Date("2025-01-15T11:00:00Z").toISOString(),
        // no tokens field at all
      },
      {
        apiKey: "key-1",
        timestamp: new Date("2025-01-15T12:00:00Z").toISOString(),
        tokens: { prompt_tokens: 50 },
      },
    ];

    const result = await getUsageByApiKey("key-1", new Date("2025-01-01T00:00:00Z"));
    expect(result).toBe(50);
  });
});

// --- Calendar period helper tests ---

describe("getHourStart", () => {
  it("returns start of current hour", () => {
    const date = new Date("2025-06-15T14:35:42.123Z");
    // getHourStart uses local time, so construct expected in local
    const result = getHourStart(date);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
    expect(result.getHours()).toBe(date.getHours());
  });
});

describe("getDayStart", () => {
  it("returns midnight of current day", () => {
    const date = new Date("2025-06-15T14:35:42.123Z");
    const result = getDayStart(date);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getDate()).toBe(date.getDate());
  });
});

describe("getWeekStart", () => {
  it("returns Monday 00:00 for a Wednesday", () => {
    // 2025-06-18 is Wednesday
    const date = new Date(2025, 5, 18, 14, 30, 0);
    const result = getWeekStart(date);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(16); // June 16 is Monday
    expect(result.getHours()).toBe(0);
  });

  it("returns Monday 00:00 for a Sunday", () => {
    // 2025-06-22 is Sunday
    const date = new Date(2025, 5, 22, 10, 0, 0);
    const result = getWeekStart(date);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(16); // June 16 is Monday
    expect(result.getHours()).toBe(0);
  });

  it("returns same day for a Monday", () => {
    // 2025-06-16 is Monday
    const date = new Date(2025, 5, 16, 10, 0, 0);
    const result = getWeekStart(date);
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(16);
  });
});

// --- In-memory counter tests ---

describe("checkKeyLimits", () => {
  beforeEach(async () => {
    counters.clear();
    const db = await getUsageDb();
    db.data.history = [];
    vi.mocked(getApiKeyByValue).mockResolvedValue(null);
  });

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
    const db = await getUsageDb();
    const now = new Date();
    db.data.history = [
      {
        apiKey: "sk-test",
        timestamp: now.toISOString(),
        tokens: { prompt_tokens: 600, completion_tokens: 500 },
      },
    ];

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
    const db = await getUsageDb();
    const now = new Date();
    db.data.history = [
      {
        apiKey: "sk-test",
        timestamp: now.toISOString(),
        tokens: { prompt_tokens: 100, completion_tokens: 50 },
      },
    ];

    vi.mocked(getApiKeyByValue).mockResolvedValue({
      key: "sk-test",
      limits: { hourly: 1000, daily: 0, weekly: 0 },
    });

    const result = await checkKeyLimits("sk-test");
    expect(result).toEqual({ allowed: true });
  });
});

describe("statsEmitter increment", () => {
  beforeEach(async () => {
    counters.clear();
    const db = await getUsageDb();
    db.data.history = [];
  });

  it("increments counter on update event for tracked key", async () => {
    // Initialize counters for the key
    vi.mocked(getApiKeyByValue).mockResolvedValue({
      key: "sk-test",
      limits: { hourly: 10000, daily: 0, weekly: 0 },
    });
    await checkKeyLimits("sk-test");

    const entry = counters.get("sk-test");
    const before = entry.hourly.total;

    // Simulate a new usage event
    statsEmitter.emit("update", {
      apiKey: "sk-test",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    expect(entry.hourly.total).toBe(before + 150);
  });

  it("ignores update for untracked key", () => {
    // No key initialized — should not throw
    statsEmitter.emit("update", {
      apiKey: "sk-unknown",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });
    expect(counters.has("sk-unknown")).toBe(false);
  });
});
