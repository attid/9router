import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";

const mockBackup = vi.fn();

vi.mock("@/lib/requestDetailsDb", () => ({
  getRequestDetailsDb: vi.fn(async () => ({
    backup: mockBackup,
  })),
}));

describe("GET /api/settings/request-details-backup", () => {
  let GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/settings/request-details-backup/route.js");
    GET = mod.GET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a downloadable sqlite backup created through sqlite backup API", async () => {
    mockBackup.mockImplementation(async (destinationPath) => {
      expect(destinationPath).toContain("request-details-backup-");
      await fs.writeFile(destinationPath, "sqlite-bytes");
      return destinationPath;
    });

    const response = await GET();
    const body = Buffer.from(await response.arrayBuffer()).toString("utf8");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.sqlite3");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-disposition")).toContain("request-details-backup.sqlite");
    expect(body).toBe("sqlite-bytes");
    expect(mockBackup).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when sqlite backup fails", async () => {
    mockBackup.mockRejectedValue(new Error("backup failed"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to export request details database");
  });
});
