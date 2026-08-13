import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { normalizeTokenLimits } from "@/shared/utils/tokenLimits.js";

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    isFree: row.isFree === 1 || row.isFree === true,
    limits: parseJson(row.limits, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    isFree: data.isFree === true,
    limits: normalizeTokenLimits(data.limits),
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, isFree, limits, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.isFree ? 1 : 0, stringifyJson(combo.limits), combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToCombo(row);
    const limits = Object.hasOwn(data, "limits")
      ? (data.limits === null
        ? null
        : normalizeTokenLimits({
          ...(current.limits || {}),
          ...normalizeTokenLimits(data.limits, { partial: true }),
        }))
      : current.limits;
    const merged = {
      ...current,
      ...data,
      isFree: Object.hasOwn(data, "isFree") ? data.isFree === true : current.isFree,
      limits,
      updatedAt: new Date().toISOString(),
    };
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, isFree = ?, limits = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.isFree ? 1 : 0, stringifyJson(merged.limits), merged.updatedAt, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
