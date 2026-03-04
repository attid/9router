function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return [...new Set(ids)].sort();
}

export function isModelHiddenForProvider(hiddenModels, { aliasKey, providerIdKey, modelId }) {
  if (!modelId) return false;
  const byAlias = Array.isArray(hiddenModels?.[aliasKey]) ? hiddenModels[aliasKey] : [];
  const byProviderId = Array.isArray(hiddenModels?.[providerIdKey]) ? hiddenModels[providerIdKey] : [];
  return byAlias.includes(modelId) || byProviderId.includes(modelId);
}

export function computeHiddenFromVisible(allModelIds, visibleModelIds) {
  const all = new Set(normalizeIdList(allModelIds));
  const visible = new Set(normalizeIdList(visibleModelIds));
  return [...all].filter((id) => !visible.has(id));
}

export function buildHiddenModelsMap(hiddenModels, providerKey, hiddenModelIds) {
  const next = { ...(hiddenModels || {}) };
  const normalized = normalizeIdList(hiddenModelIds);
  if (!providerKey) return next;
  if (normalized.length > 0) {
    next[providerKey] = normalized;
  } else {
    delete next[providerKey];
  }
  return next;
}
