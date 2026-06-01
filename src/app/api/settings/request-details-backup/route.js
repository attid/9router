import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getRequestDetailsDb } from "@/lib/requestDetailsDb";

export async function GET() {
  const backupFilename = "request-details-backup.json";
  const tempPath = path.join(
    os.tmpdir(),
    `request-details-backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`
  );

  try {
    const db = await getRequestDetailsDb();
    await db.backup(tempPath);

    const buffer = await fs.readFile(tempPath);

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${backupFilename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    console.error("Error exporting request details database:", error);
    return Response.json({ error: "Failed to export request details database" }, { status: 500 });
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}
