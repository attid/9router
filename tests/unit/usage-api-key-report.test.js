import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildApiKeyUsageRows } from "../../src/app/(dashboard)/dashboard/usage/components/apiKeyUsageReport.js";

const RAW_KEY = "raw-api-key-value-never-expose";
const MASKED_KEY = "raw-api-***";

const stats = {
  byApiKey: {
    [`${MASKED_KEY}|kimi-k2|kimi-coding`]: {
      apiKeyMasked: MASKED_KEY,
      keyName: "Annie",
      rawModel: "kimi-k2",
      provider: "Kimi Coding",
      requests: 3,
      promptTokens: 100,
      completionTokens: 40,
      cachedTokens: 25,
      cost: 0.12,
      lastUsed: "2026-06-01T12:00:00.000Z",
    },
    "s***|claude-sonnet|anthropic": {
      apiKeyMasked: "s***",
      apiKeyKey: "s***",
      keyName: "Other",
      rawModel: "claude-sonnet",
      provider: "Anthropic",
      requests: 10,
      promptTokens: 1000,
      completionTokens: 300,
      cachedTokens: 400,
      cost: 2.5,
      lastUsed: "2026-06-01T10:00:00.000Z",
    },
    "local-no-key|kimi-k2|kimi-coding": {
      apiKeyMasked: null,
      apiKeyKey: "local-no-key",
      keyName: "Local (No API Key)",
      rawModel: "kimi-k2",
      provider: "Kimi Coding",
      requests: 1,
      promptTokens: 5,
      completionTokens: 5,
      cachedTokens: 0,
      cost: 0,
      lastUsed: "2026-06-01T09:00:00.000Z",
    },
  },
};

describe("buildApiKeyUsageRows", () => {
  it("returns masked API-key usage rows sorted by total tokens", () => {
    const rows = buildApiKeyUsageRows(stats);

    expect(rows.map((row) => row.keyName)).toEqual(["Other", "Annie", "Local (No API Key)"]);
    expect(rows[1]).toMatchObject({
      apiKeyMasked: MASKED_KEY,
      keyName: "Annie",
      model: "kimi-k2",
      provider: "Kimi Coding",
      totalTokens: 140,
      cachedTokens: 25,
      requests: 3,
    });
    expect(rows[1]).not.toHaveProperty("apiKey");
  });

  it("filters only by masked key, name, provider, or model", () => {
    expect(buildApiKeyUsageRows(stats, { query: "kimi" }).map((row) => row.keyName)).toEqual([
      "Annie",
      "Local (No API Key)",
    ]);
    expect(buildApiKeyUsageRows(stats, { query: "annie" }).map((row) => row.keyName)).toEqual(["Annie"]);
    expect(buildApiKeyUsageRows(stats, { query: MASKED_KEY }).map((row) => row.keyName)).toEqual(["Annie"]);
    expect(buildApiKeyUsageRows(stats, { query: RAW_KEY })).toEqual([]);
  });

  it("does not copy a raw API key even if an unexpected payload contains one", () => {
    const unsafeStats = {
      byApiKey: {
        unsafe: {
          ...stats.byApiKey[`${MASKED_KEY}|kimi-k2|kimi-coding`],
          apiKey: RAW_KEY,
        },
      },
    };

    const serializedRows = JSON.stringify(buildApiKeyUsageRows(unsafeStats));
    expect(serializedRows).not.toContain(RAW_KEY);
    expect(serializedRows).not.toContain('"apiKey"');
  });

  it("handles missing stats as an empty report", () => {
    expect(buildApiKeyUsageRows(null)).toEqual([]);
    expect(buildApiKeyUsageRows({})).toEqual([]);
  });
});

describe("API key usage tab integration", () => {
  it("uses the current upstream URLs and masked API-key field", () => {
    const componentPath = path.resolve("src/app/(dashboard)/dashboard/usage/components/APIKeyUsageTab.js");
    const pagePath = path.resolve("src/app/(dashboard)/dashboard/usage/page.js");
    const component = fs.readFileSync(componentPath, "utf8");
    const page = fs.readFileSync(pagePath, "utf8");

    expect(component).toContain("/api/usage/stats?period=");
    expect(component).toContain("row.apiKeyMasked");
    expect(component).not.toMatch(/row\.apiKey(?!Masked|Key)/);
    expect(component).toContain('Metric label="Cached"');
    expect(component).toContain("row.cachedTokens");
    expect(component).toContain(">Cached</th>");
    expect(component).toContain("new AbortController()");
    expect(component).toContain("signal: controller.signal");
    expect(component).toContain("return () => controller.abort()");
    expect(page).toContain('{ value: "keys", label: "API Keys" }');
    expect(page).toContain('<APIKeyUsageTab period={period} />');
  });
});

describe("API key usage aggregation", () => {
  const originalDataDir = process.env.DATA_DIR;
  const firstKey = "sk-collision-prefix-first-secret";
  const secondKey = "sk-collision-prefix-second-secret";
  let tempDir;
  let db;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-key-report-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("../../src/lib/db/index.js");
    await db.initDb();
    await db.importDb({
      apiKeys: [
        { id: "stable-key-id-first", key: firstKey, name: "First collision", machineId: "m1" },
        { id: "stable-key-id-second", key: secondKey, name: "Second collision", machineId: "m2" },
      ],
    });

    await db.saveRequestUsage({
      timestamp: new Date(Date.now() - 2000).toISOString(),
      provider: "openai",
      model: "gpt-4o",
      apiKey: firstKey,
      tokens: { prompt_tokens: 100, completion_tokens: 10, cached_tokens: 40 },
      status: "ok",
    });
    await db.saveRequestUsage({
      timestamp: new Date(Date.now() - 1000).toISOString(),
      provider: "openai",
      model: "gpt-4o",
      apiKey: secondKey,
      tokens: { prompt_tokens: 200, completion_tokens: 20, cached_tokens: 80 },
      status: "ok",
    });
  });

  afterAll(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it.each(["24h", "7d"])("keeps keys with the same masked prefix separate for %s", async (period) => {
    const statsForPeriod = await db.getUsageStats(period);
    const entries = Object.values(statsForPeriod.byApiKey);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.keyName).sort()).toEqual([
      "First collision",
      "Second collision",
    ]);
    expect(entries.map((entry) => entry.cachedTokens).sort((a, b) => a - b)).toEqual([40, 80]);

    const response = JSON.stringify(statsForPeriod.byApiKey);
    expect(response).not.toContain(firstKey);
    expect(response).not.toContain(secondKey);
    expect(response).not.toContain("stable-key-id-first");
    expect(response).not.toContain("stable-key-id-second");
    expect(entries.every((entry) => !Object.hasOwn(entry, "apiKeyKey"))).toBe(true);
    expect(entries.every((entry) => !Object.hasOwn(entry, "apiKeyId"))).toBe(true);
  });
});
