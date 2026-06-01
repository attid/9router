import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }
});

describe("requestDetailsDb persistence", () => {
  it("preserves api key and endpoint metadata in saved request details", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "request-details-db-"));
    process.env.DATA_DIR = tempDir;

    vi.doMock("@/lib/dataDir.js", () => ({
      DATA_DIR: tempDir,
      getDataDir: () => tempDir,
    }));

    vi.doMock("@/lib/localDb", () => ({
      getSettings: vi.fn(async () => ({
        enableObservability: true,
        observabilityBatchSize: 1,
        observabilityMaxRecords: 50,
        observabilityFlushIntervalMs: 1,
        observabilityMaxJsonSize: 8,
      })),
    }));

    const { saveRequestDetail, getRequestDetails } = await import("../../src/lib/requestDetailsDb.js");

    await saveRequestDetail({
      id: "req-1",
      provider: "claude",
      model: "claude-sonnet-4",
      connectionId: "conn-1",
      apiKeyId: "key-abc",
      timestamp: "2026-05-03T12:00:00.000Z",
      status: "success",
      latency: { ttft: 123, total: 456 },
      tokens: { prompt_tokens: 10, completion_tokens: 20 },
      clientEndpoint: "/v1/chat/completions",
      providerUrl: "https://api.anthropic.com/v1/messages",
      request: { method: "POST" },
      providerRequest: { model: "claude-sonnet-4" },
      providerResponse: { id: "upstream-1" },
      response: { id: "client-1" },
    });

    const { details } = await getRequestDetails({ page: 1, pageSize: 10 });

    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      id: "req-1",
      apiKeyId: "key-abc",
      clientEndpoint: "/v1/chat/completions",
      providerUrl: "https://api.anthropic.com/v1/messages",
    });
  });
});
