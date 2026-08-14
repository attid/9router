import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-request-details-overlay-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({
    enableObservability2: true,
    observabilityBatchSize: 50,
    observabilityFlushIntervalMs: 10000,
  });
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("SQLite request-details observability overlay", () => {
  it("persists a stable key ID and endpoints without persisting the raw client key", async () => {
    const apiKey = await db.createApiKey("Codex workstation", "machine-request-details");

    await db.saveRequestDetail({
      id: "overlay-detail-1",
      provider: "anthropic",
      model: "claude-test",
      apiKey: apiKey.key,
      clientEndpoint: "/v1/messages",
      providerUrl: "https://api.anthropic.com/v1/messages",
      request: {
        headers: {
          authorization: `Bearer ${apiKey.key}`,
          "x-safe-header": "visible",
        },
      },
      response: { content: "ok" },
      status: "success",
    });

    const { createRequestDetailsExportStream } = await import("@/lib/requestDetailsDb.js");
    await new Response(await createRequestDetailsExportStream()).text();
    const stored = await db.getRequestDetailById("overlay-detail-1");
    const serialized = JSON.stringify(stored);

    expect(stored.apiKeyId).toBe(apiKey.id);
    expect(stored.clientEndpoint).toBe("/v1/messages");
    expect(stored.providerUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(stored.request.headers).toEqual({ "x-safe-header": "visible" });
    expect(serialized).not.toContain(apiKey.key);
    expect(stored).not.toHaveProperty("apiKey");
  });

  it("streams a versioned request-details-only export from SQLite", async () => {
    const { createRequestDetailsExportStream } = await import("@/lib/requestDetailsDb.js");
    const exported = await new Response(await createRequestDetailsExportStream()).json();

    expect(exported).toMatchObject({
      format: "9router-request-details-export",
      version: 1,
    });
    expect(exported.requestDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "overlay-detail-1" }),
    ]));
  });

  it("does not let a stale streaming placeholder overwrite a terminal detail", async () => {
    const placeholder = {
      id: "terminal-detail-1",
      provider: "openai",
      model: "gpt-test",
      response: { content: "[Streaming in progress...]" },
      status: "success",
    };
    await db.saveRequestDetail(placeholder);
    await db.saveRequestDetail({
      ...placeholder,
      response: { error: "transform failed", status: 502 },
      status: "error",
    });
    await db.saveRequestDetail(placeholder);
    await db.flushRequestDetails();

    expect(await db.getRequestDetailById("terminal-detail-1")).toMatchObject({
      status: "error",
      response: { error: "transform failed", status: 502 },
    });
  });
});
