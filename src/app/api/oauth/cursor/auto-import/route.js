import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";

const execFileAsync = promisify(execFile);

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = ["storage.serviceMachineId", "storage.machineId", "telemetry.machineId"];

/** Get candidate db paths by platform */
function getCandidatePaths(platform) {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
      join(home, "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb"),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(appData, "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Programs", "Cursor", "User", "globalStorage", "state.vscdb"),
    ];
  }

  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
}

/** Extract tokens using better-sqlite3 (stream-based, no RAM limit) */
function extractTokens(db) {
  const desiredKeys = [...ACCESS_TOKEN_KEYS, ...MACHINE_ID_KEYS];
  const rows = db.prepare(
    `SELECT key, value FROM itemTable WHERE key IN (${desiredKeys.map(() => "?").join(",")})`
  ).all(...desiredKeys);

  const normalize = (value) => {
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  const tokens = {};
  for (const row of rows) {
    if (ACCESS_TOKEN_KEYS.includes(row.key) && !tokens.accessToken) {
      tokens.accessToken = normalize(row.value);
    } else if (MACHINE_ID_KEYS.includes(row.key) && !tokens.machineId) {
      tokens.machineId = normalize(row.value);
    }
  }

  // Fuzzy fallback
  if (!tokens.accessToken || !tokens.machineId) {
    const fallbackRows = db.prepare(
      "SELECT key, value FROM itemTable WHERE key LIKE '%cursorAuth/%' OR key LIKE '%machineId%' OR key LIKE '%serviceMachineId%'"
    ).all();

    for (const row of fallbackRows) {
      const key = row.key || "";
      const value = normalize(row.value);
      if (!tokens.accessToken && key.toLowerCase().includes("accesstoken")) {
        tokens.accessToken = value;
      }
      if (!tokens.machineId && key.toLowerCase().includes("machineid")) {
        tokens.machineId = value;
      }
    }
  }

  return tokens;
}

/**
 * Extract tokens via sqlite3 CLI (fallback for Windows when native addon fails)
 * Queries each key individually and parses output
 */
async function extractTokensViaCLI(dbPath) {
  const normalize = (raw) => {
    const value = raw.trim();
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  const query = async (sql) => {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], { timeout: 10000 });
    return stdout.trim();
  };

  // Try each key in priority order
  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    try {
      const raw = await query(`SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`);
      if (raw) { accessToken = normalize(raw); break; }
    } catch { /* try next */ }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    try {
      const raw = await query(`SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`);
      if (raw) { machineId = normalize(raw); break; }
    } catch { /* try next */ }
  }

  return { accessToken, machineId };
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database.
 * Strategy: better-sqlite3 (native, fast) → sqlite3 CLI (fallback) → windowsManual
 */
export async function GET() {
  try {
    const platform = process.platform;
    if (!["darwin", "linux", "win32"].includes(platform)) {
      return NextResponse.json({ found: false, error: "Unsupported platform" }, { status: 400 });
    }

    const candidates = getCandidatePaths(platform);

    let dbPath = null;
    if (platform === "darwin") {
      for (const candidate of candidates) {
        try {
          await access(candidate, constants.R_OK);
          dbPath = candidate;
          break;
        } catch {
          // Try next candidate
        }
      }
    } else {
      // Keep legacy behavior for linux/win32: single hardcoded path, no probing.
      dbPath = candidates[0];
    }

    if (!dbPath && platform === "darwin") {
      return NextResponse.json({
        found: false,
        error: `Cursor database not found in known macOS locations.\nChecked locations:\n${candidates.join("\n")}`,
      });
    }

    if (!dbPath) {
      return NextResponse.json({
        found: false,
        error: "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
      });
    }

    const genericLegacyError = "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.";

    // Strategy 1: better-sqlite3 bundled → then global install fallback
    let Database = null;
    try {
      const mod = await import("better-sqlite3");
      Database = mod.default;
    } catch {
      // Try loading from global node_modules (user ran: npm i better-sqlite3 -g)
      try {
        const globalRoot = execSync("npm root -g", { timeout: 5000 }).toString().trim();
        const requireGlobal = createRequire(join(globalRoot, "better-sqlite3", "package.json"));
        Database = requireGlobal("better-sqlite3");
      } catch { /* fall through to sqlite3 CLI strategy */ }
    }

    if (Database) {
      let db;
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const tokens = extractTokens(db);
        db.close();

        if (tokens.accessToken && tokens.machineId) {
          return NextResponse.json({ found: true, accessToken: tokens.accessToken, machineId: tokens.machineId });
        }

        if (platform === "darwin") {
          return NextResponse.json({
            found: false,
            error: "Please login to Cursor IDE first (could not find access token and machine ID).",
          });
        }

        return NextResponse.json({ found: false, error: genericLegacyError });
      } catch (error) {
        db?.close();
        if (platform === "darwin") {
          return NextResponse.json({
            found: false,
            error: `Cursor database found but could not open it: ${error?.message || String(error)}`,
          });
        }
        return NextResponse.json({ found: false, error: genericLegacyError });
      }
    }

    // Strategy 2: sqlite3 CLI (works on Windows if sqlite3 is installed)
    try {
      const tokens = await extractTokensViaCLI(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({ found: true, accessToken: tokens.accessToken, machineId: tokens.machineId });
      }
    } catch { /* sqlite3 CLI not available */ }

    // Strategy 3: ask user to paste manually
    if (platform === "darwin") {
      return NextResponse.json({
        found: false,
        error: "Please login to Cursor IDE first (could not find access token and machine ID).",
      });
    }

    return NextResponse.json({ found: false, error: genericLegacyError });
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json({ found: false, error: error.message }, { status: 500 });
  }
}
