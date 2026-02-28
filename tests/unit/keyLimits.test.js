/**
 * Unit tests for API key token limit checking.
 *
 * Tests cover:
 *  - getUsageByApiKey() — aggregation of tokens by API key within a time window
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
// Use "node:fs" to ensure Vitest resolves the Node.js built-in, not the npm "fs" shim package
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
}));

// Mock requestDetailsDb to avoid SQLite dependency
vi.mock("../../src/lib/requestDetailsDb.js", () => ({
  saveRequestDetail: vi.fn(),
  getRequestDetails: vi.fn(),
  getRequestDetailById: vi.fn(),
}));

import { getUsageByApiKey, getUsageDb } from "../../src/lib/usageDb.js";

// --- Tests ---

describe("getUsageByApiKey", () => {
  beforeEach(async () => {
    // Reset the DB history before each test
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
    expect(result).toBe(50); // only the last entry has prompt_tokens=50, rest are 0
  });
});
