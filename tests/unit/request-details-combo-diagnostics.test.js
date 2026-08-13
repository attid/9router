import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-details-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({
    enableObservability2: true,
    observabilityBatchSize: 1,
  });
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("combo limit request details", () => {
  it("persists structured routing diagnostics", async () => {
    await db.saveRequestDetail({
      id: "combo-limit-detail",
      timestamp: "2026-11-01T05:30:00.000Z",
      provider: "combo",
      model: "free_kimi",
      status: "branch_skipped",
      eventType: "combo_limit",
      routing: {
        rootModel: "BIG",
        comboPath: [
          { id: "combo-big", name: "BIG" },
          { id: "combo-kimi", name: "free_kimi" },
        ],
        blockedCombo: { id: "combo-kimi", name: "free_kimi" },
      },
      apiKeyIdentity: { id: "key-1", name: "User A" },
      limit: { period: "hourly", used: 1_050, limit: 1_000, retryAfter: 42, resetAt: "2026-11-01T06:00:00.000Z" },
    });
    await vi.waitFor(async () => {
      expect(await db.getRequestDetailById("combo-limit-detail")).not.toBeNull();
    });

    const detail = await db.getRequestDetailById("combo-limit-detail");
    expect(detail).toMatchObject({
      eventType: "combo_limit",
      status: "branch_skipped",
      routing: { rootModel: "BIG", blockedCombo: { id: "combo-kimi" } },
      apiKeyIdentity: { id: "key-1", name: "User A" },
      limit: { period: "hourly", used: 1_050, limit: 1_000 },
    });
  });

  it("renders readable combo limit diagnostics", () => {
    const source = fs.readFileSync(
      path.resolve("src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js"),
      "utf8",
    );
    expect(source).toContain('detail.eventType === "combo_limit"');
    expect(source).toContain("Combo limit");
    expect(source).toContain("selectedDetail.routing.comboPath");
    expect(source).toContain("selectedDetail.apiKeyIdentity");
    expect(source).toContain("selectedDetail.limit.resetAt");
  });
});
