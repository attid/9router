import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { invalidateKeyLimitCounters } from "@/shared/utils/keyLimitCounters.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    limits: parseJson(row.limits, null),
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

function normalizeLimitValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function normalizeLimits(limits, existing = {}) {
  if (!limits) return null;
  return {
    hourly: Object.hasOwn(limits, "hourly") ? normalizeLimitValue(limits.hourly) : existing.hourly ?? null,
    daily: Object.hasOwn(limits, "daily") ? normalizeLimitValue(limits.daily) : existing.daily ?? null,
    weekly: Object.hasOwn(limits, "weekly") ? normalizeLimitValue(limits.weekly) : existing.weekly ?? null,
  };
}

export async function createApiKey(name, machineId, limits = null) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    limits: normalizeLimits(limits),
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, limits, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, stringifyJson(apiKey.limits), 1, apiKey.createdAt]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    const merged = {
      ...current,
      ...data,
      limits: Object.hasOwn(data, "limits")
        ? normalizeLimits(data.limits, current.limits || {})
        : current.limits,
    };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, limits = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, stringifyJson(merged.limits), merged.isActive ? 1 : 0, id]
    );
    if (Object.hasOwn(data, "limits") || merged.key !== current.key) {
      invalidateKeyLimitCounters(current.key);
      if (merged.key !== current.key) invalidateKeyLimitCounters(merged.key);
    }
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT key FROM apiKeys WHERE id = ?`, [id]);
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  if ((res?.changes ?? 0) > 0 && row?.key) invalidateKeyLimitCounters(row.key);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

export async function getApiKeyByValue(key) {
  const db = await getAdapter();
  return rowToKey(db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]));
}
