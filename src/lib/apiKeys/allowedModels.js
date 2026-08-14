export function normalizeAllowedModels(value) {
  if (value === undefined || value === null) {
    return { value: null };
  }
  if (!Array.isArray(value)) {
    return { error: "allowedModels must be an array or null" };
  }
  if (value.some((model) => typeof model !== "string" || !model.trim())) {
    return { error: "allowedModels must contain non-empty strings" };
  }

  const models = [...new Set(value.map((model) => model.trim()))];
  return { value: models.length > 0 ? models : null };
}
