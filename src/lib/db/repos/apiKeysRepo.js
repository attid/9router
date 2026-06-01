import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    limits: parseJson(row.limits, null),
    allowedModels: parseJson(row.allowedModels, null),
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

function normalizeLimits(limits, existing = {}) {
  if (limits == null) return null;
  return {
    hourly: limits.hourly ?? existing.hourly ?? null,
    daily: limits.daily ?? existing.daily ?? null,
    weekly: limits.weekly ?? existing.weekly ?? null,
  };
}

function normalizeAllowedModels(allowedModels) {
  if (!Array.isArray(allowedModels) || allowedModels.length === 0) return null;
  return allowedModels;
}

export async function createApiKey(name, machineId, options = null) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const opts = options && typeof options === "object" && !Array.isArray(options)
    ? options
    : { limits: options };
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    limits: normalizeLimits(opts.limits),
    allowedModels: normalizeAllowedModels(opts.allowedModels),
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, limits, allowedModels, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      stringifyJson(apiKey.limits),
      stringifyJson(apiKey.allowedModels),
      apiKey.createdAt,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    if (data.limits !== undefined) {
      merged.limits = normalizeLimits(data.limits, rowToKey(row).limits || {});
    }
    if (data.allowedModels !== undefined) {
      merged.allowedModels = normalizeAllowedModels(data.allowedModels);
    }
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, limits = ?, allowedModels = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        stringifyJson(merged.limits),
        stringifyJson(merged.allowedModels),
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
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
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}
