// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { invalidateKeyLimitCounters } from "@/shared/utils/keyLimitCounters.js";
import { invalidateComboLimitCounters } from "@/shared/utils/comboLimitCounters.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, getApiKeyByValue, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageByApiKey, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const out = {
    formatVersion: 2,
    settings: await exportSettings(),
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, limits: parseJson(r.limits, null), isActive: r.isActive === 1, createdAt: r.createdAt })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), isFree: r.isFree === 1, limits: parseJson(r.limits, null), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
    usageHistory: db.all(`SELECT * FROM usageHistory ORDER BY id ASC`).map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      provider: r.provider,
      model: r.model,
      connectionId: r.connectionId,
      apiKey: r.apiKey,
      endpoint: r.endpoint,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      cost: r.cost,
      status: r.status,
      tokens: parseJson(r.tokens, {}) || {},
      meta: parseJson(r.meta, {}) || {},
    })),
    usageDaily: db.all(`SELECT dateKey, data FROM usageDaily ORDER BY dateKey ASC`).map((r) => ({
      dateKey: r.dateKey,
      data: parseJson(r.data, {}) || {},
    })),
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const hasUsageHistory = Object.hasOwn(payload, "usageHistory");
  const hasUsageDaily = Object.hasOwn(payload, "usageDaily");
  if (hasUsageHistory && !Array.isArray(payload.usageHistory)) {
    throw new Error("Invalid usage history in database payload");
  }
  if (hasUsageDaily && !Array.isArray(payload.usageDaily)) {
    throw new Error("Invalid daily usage in database payload");
  }
  const restoresPositiveLimits = (payload.apiKeys || []).some((key) =>
    Object.values(key?.limits || {}).some((limit) => Number.isFinite(Number(limit)) && Number(limit) > 0),
  );
  if (restoresPositiveLimits && !hasUsageHistory) {
    throw new Error("Cannot restore API key limits without usage history; export the full database first");
  }
  const db = await getAdapter();

  db.transaction(() => {
    // Wipe all tables (keep _meta)
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')`);
    if (hasUsageHistory) {
      db.run(`DELETE FROM usageHistory`);
      db.run(`DELETE FROM usageDaily`);
    }

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      db.run(
        `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, limits, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [k.id, k.key, k.name || null, k.machineId || null, stringifyJson(k.limits || null), k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
      );
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, isFree, limits, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.isFree === true ? 1 : 0, stringifyJson(c.limits || null), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
    if (hasUsageHistory) {
      for (const row of payload.usageHistory) {
        if (!row || typeof row !== "object" || !row.timestamp) {
          throw new Error("Invalid usage history row in database payload");
        }
        const tokens = row.tokens && typeof row.tokens === "object" ? row.tokens : {};
        const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
        const promptTokens = row.promptTokens ?? tokens.prompt_tokens ?? tokens.input_tokens ?? 0;
        const completionTokens = row.completionTokens ?? tokens.completion_tokens ?? tokens.output_tokens ?? 0;
        db.run(
          `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            new Date(row.timestamp).toISOString(), row.provider || null, row.model || null,
            row.connectionId || null, row.apiKey || null, row.endpoint || null,
            promptTokens, completionTokens, row.cost || 0, row.status || "ok",
            stringifyJson(tokens), stringifyJson(meta),
          ],
        );
      }
      if (hasUsageDaily) {
        for (const row of payload.usageDaily) {
          if (!row || typeof row !== "object" || typeof row.dateKey !== "string" || !row.data || typeof row.data !== "object" || Array.isArray(row.data)) {
            throw new Error("Invalid daily usage row in database payload");
          }
          db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`, [row.dateKey, stringifyJson(row.data)]);
        }
      }
    }
  });

  invalidateKeyLimitCounters();
  invalidateComboLimitCounters();
  const { rebuildUsageDaily, resetUsageCaches } = await import("./repos/usageRepo.js");
  resetUsageCaches();
  if (hasUsageHistory && !hasUsageDaily) await rebuildUsageDaily();

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
