import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildApiKeyUsageRows } from "../../src/app/(dashboard)/dashboard/usage/components/apiKeyUsageReport.js";

const RAW_KEY = "raw-api-key-value-never-expose";
const MASKED_KEY = "raw-api-***";

const stats = {
  byApiKey: {
    [`${MASKED_KEY}|kimi-k2|kimi-coding`]: {
      apiKeyMasked: MASKED_KEY,
      apiKeyKey: MASKED_KEY,
      keyName: "Annie",
      rawModel: "kimi-k2",
      provider: "Kimi Coding",
      requests: 3,
      promptTokens: 100,
      completionTokens: 40,
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
      apiKeyKey: MASKED_KEY,
      keyName: "Annie",
      model: "kimi-k2",
      provider: "Kimi Coding",
      totalTokens: 140,
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
    expect(component).not.toContain("apiPath");
    expect(component).toContain("row.apiKeyMasked");
    expect(component).not.toMatch(/row\.apiKey(?!Masked|Key)/);
    expect(page).toContain('{ value: "keys", label: "API Keys" }');
    expect(page).toContain('<APIKeyUsageTab period={period} />');
  });
});
