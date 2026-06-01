import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";

export const KIMI_CLI_VERSION = "1.37.0";
export const KIMI_OAUTH_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
export const KIMI_OAUTH_SCOPE = "kimi-code";

const DEVICE_ID_DIR = path.join(os.homedir(), ".kimi");
const DEVICE_ID_PATH = path.join(DEVICE_ID_DIR, "device_id");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function asciiHeaderValue(value, fallback = "unknown") {
  const sanitized = String(value || "").replace(/[^\x20-\x7e]/g, "").trim();
  return sanitized || fallback;
}

let cachedMacVersion;

function macProductVersion() {
  if (process.platform !== "darwin") return undefined;
  if (cachedMacVersion !== undefined) return cachedMacVersion || undefined;

  try {
    cachedMacVersion = childProcess.execFileSync("sw_vers", ["-productVersion"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    cachedMacVersion = "";
  }

  return cachedMacVersion || undefined;
}

function kimiDeviceModel() {
  const system = os.type();
  const release = os.release();
  const machine = os.machine?.() || os.arch();

  if (system === "Darwin") {
    const version = macProductVersion() || release;
    if (version && machine) return `macOS ${version} ${machine}`;
    if (version) return `macOS ${version}`;
    return `macOS ${machine}`.trim();
  }

  if (system === "Windows_NT") {
    const parts = release.split(".");
    const build = Number(parts[2] || "");
    const label = parts[0] === "10" ? (Number.isFinite(build) && build >= 22000 ? "11" : "10") : release;
    if (label && machine) return `Windows ${label} ${machine}`;
    if (label) return `Windows ${label}`;
    return `Windows ${machine}`.trim();
  }

  if (system) {
    if (release && machine) return `${system} ${release} ${machine}`;
    if (release) return `${system} ${release}`;
    return `${system} ${machine}`.trim();
  }

  return "Unknown";
}

export function getKimiDeviceId() {
  ensureDir(DEVICE_ID_DIR);

  if (fs.existsSync(DEVICE_ID_PATH)) {
    const existing = fs.readFileSync(DEVICE_ID_PATH, "utf8").trim();
    if (existing) return existing;
  }

  const id = crypto.randomUUID().replace(/-/g, "");
  fs.writeFileSync(DEVICE_ID_PATH, id, { mode: 0o600 });
  return id;
}

export function buildKimiHeaders() {
  return {
    "User-Agent": `KimiCLI/${KIMI_CLI_VERSION}`,
    "X-Msh-Platform": "kimi_cli",
    "X-Msh-Version": KIMI_CLI_VERSION,
    "X-Msh-Device-Name": asciiHeaderValue(os.hostname() || "unknown"),
    "X-Msh-Device-Model": asciiHeaderValue(kimiDeviceModel()),
    "X-Msh-Device-Id": getKimiDeviceId(),
    "X-Msh-Os-Version": asciiHeaderValue(os.version?.() || `${os.type()} ${os.release()}`),
  };
}
