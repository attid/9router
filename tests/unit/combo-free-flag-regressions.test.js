import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

describe("combo free flag regressions", () => {
  it("keeps the free combo toggle in the combo edit UI", () => {
    const source = read("src/app/(dashboard)/dashboard/combos/page.js");

    expect(source).toContain("Free / unmetered combo");
    expect(source).toContain("combo?.isFree === true");
    expect(source).toContain("isFree");
  });

  it("persists isFree through the combos API and local DB", () => {
    expect(read("src/app/api/combos/route.js")).toMatch(/isFree:\s*isFree === true/);
    expect(read("src/app/api/combos/[id]/route.js")).toContain('Object.hasOwn(body, "isFree")');
    expect(read("src/lib/db/schema.js")).toContain("isFree");
    expect(read("src/lib/db/repos/combosRepo.js")).toMatch(/isFree:\s*data\.isFree === true/);
  });

  it("marks usage unmetered only for combos explicitly flagged as free", () => {
    const source = read("src/sse/handlers/chat.js");

    expect(source).toContain("getComboByName");
    expect(source).toMatch(/combo\?\.isFree === true/);
    expect(source).toContain("metered: false");
    expect(source).toContain("!requestedComboIsFree");
  });
});
