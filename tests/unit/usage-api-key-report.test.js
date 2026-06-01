import { describe, expect, it } from "vitest";

import { buildApiKeyUsageRows } from "../../src/app/(dashboard)/dashboard/usage/components/apiKeyUsageReport.js";

const stats = {
  byApiKey: {
    "sk-annie|kimi-k2|kimi-coding": {
      apiKey: "sk-annie",
      apiKeyKey: "sk-annie",
      keyName: "Annie",
      rawModel: "kimi-k2",
      provider: "Kimi Coding",
      requests: 3,
      promptTokens: 100,
      completionTokens: 40,
      cost: 0.12,
      lastUsed: "2026-06-01T12:00:00.000Z",
    },
    "sk-igor|kimi-k2|kimi-coding": {
      apiKey: "sk-igor",
      apiKeyKey: "sk-igor",
      keyName: "Igor",
      rawModel: "kimi-k2",
      provider: "Kimi Coding",
      requests: 2,
      promptTokens: 50,
      completionTokens: 20,
      cost: 0.06,
      lastUsed: "2026-06-01T11:00:00.000Z",
    },
    "sk-other|claude-sonnet|anthropic": {
      apiKey: "sk-other",
      apiKeyKey: "sk-other",
      keyName: "Other",
      rawModel: "claude-sonnet",
      provider: "Anthropic",
      requests: 10,
      promptTokens: 1000,
      completionTokens: 300,
      cost: 2.5,
      lastUsed: "2026-06-01T10:00:00.000Z",
    },
    "local-no-key": {
      apiKey: null,
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
  it("returns API-key usage rows sorted by total tokens", () => {
    const rows = buildApiKeyUsageRows(stats);

    expect(rows.map((row) => row.keyName)).toEqual(["Other", "Annie", "Igor", "Local (No API Key)"]);
    expect(rows[1]).toMatchObject({
      keyName: "Annie",
      model: "kimi-k2",
      provider: "Kimi Coding",
      totalTokens: 140,
      requests: 3,
    });
  });

  it("filters rows by provider, model, or API key text", () => {
    expect(buildApiKeyUsageRows(stats, { query: "kimi" }).map((row) => row.keyName)).toEqual([
      "Annie",
      "Igor",
      "Local (No API Key)",
    ]);

    expect(buildApiKeyUsageRows(stats, { query: "igor" }).map((row) => row.keyName)).toEqual(["Igor"]);
    expect(buildApiKeyUsageRows(stats, { query: "claude" }).map((row) => row.keyName)).toEqual(["Other"]);
  });

  it("handles missing stats as an empty report", () => {
    expect(buildApiKeyUsageRows(null)).toEqual([]);
    expect(buildApiKeyUsageRows({})).toEqual([]);
  });
});
