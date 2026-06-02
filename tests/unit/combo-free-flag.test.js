import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

async function loadLocalDb() {
  vi.resetModules();
  delete global._dbAdapter;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "combo-free-"));
  return import("../../src/lib/localDb.js");
}

afterEach(() => {
  vi.resetModules();
  delete global._dbAdapter;
  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }
});

describe("combo free flag", () => {
  it("persists isFree on create and update", async () => {
    const { createCombo, updateCombo, getComboById } = await loadLocalDb();

    const combo = await createCombo({
      name: "free_combo",
      models: ["provider/model"],
      isFree: true,
    });

    expect(combo.isFree).toBe(true);
    expect((await getComboById(combo.id)).isFree).toBe(true);

    const updated = await updateCombo(combo.id, { isFree: false });

    expect(updated.isFree).toBe(false);
    expect((await getComboById(combo.id)).isFree).toBe(false);

    await updateCombo(combo.id, { isFree: true });
    await updateCombo(combo.id, { models: ["provider/other-model"] });

    const preserved = await getComboById(combo.id);
    expect(preserved.isFree).toBe(true);
    expect(preserved.models).toEqual(["provider/other-model"]);
  });
});
