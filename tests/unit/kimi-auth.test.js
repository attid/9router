import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Kimi auth headers", () => {
  let tempHome;
  let originalHome;
  let buildKimiHeaders;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "kimi-home-"));
    process.env.HOME = tempHome;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    vi.restoreAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("reuses a stable device id and emits kimi-cli style headers", async () => {
    ({ buildKimiHeaders } = await import("../../src/lib/kimi/headers.js"));
    vi.spyOn(os, "hostname").mockReturnValue("dev-box");

    const headersA = buildKimiHeaders();
    const headersB = buildKimiHeaders();

    expect(headersA["User-Agent"]).toBe("KimiCLI/1.37.0");
    expect(headersA["X-Msh-Platform"]).toBe("kimi_cli");
    expect(headersA["X-Msh-Version"]).toBe("1.37.0");
    expect(headersA["X-Msh-Device-Name"]).toBe("dev-box");
    expect(headersA["X-Msh-Device-Id"]).toMatch(/^[a-f0-9]{32}$/);
    expect(headersB["X-Msh-Device-Id"]).toBe(headersA["X-Msh-Device-Id"]);

    const deviceIdPath = path.join(tempHome, ".kimi", "device_id");
    expect(fs.existsSync(deviceIdPath)).toBe(true);
    expect(fs.readFileSync(deviceIdPath, "utf8").trim()).toBe(headersA["X-Msh-Device-Id"]);
  });
});
