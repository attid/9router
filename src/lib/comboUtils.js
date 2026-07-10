/**
 * Return the model name from either a legacy string member or a structured one.
 */
export function getComboModelName(entry) {
  return typeof entry === "string" ? entry : entry?.model;
}

/**
 * Normalize combo members to the canonical SQLite/API representation.
 * Validation belongs at write boundaries; this function stays tolerant so old
 * rows can be read and repaired through the UI.
 */
export function normalizeComboModels(models) {
  if (!Array.isArray(models)) return [];
  return models.map((entry) => ({
    model: getComboModelName(entry),
    weight: typeof entry === "string" ? 1 : (entry?.weight ?? 1),
  }));
}

/**
 * Normalize members to model names for consumers such as Fusion.
 */
export function getComboModelNames(models) {
  if (!Array.isArray(models)) return [];
  return models.map(getComboModelName).filter(Boolean);
}

/**
 * Return null for a valid models payload, otherwise a user-facing error.
 */
export function validateComboModels(models) {
  if (!Array.isArray(models)) return "Models must be an array";

  for (let index = 0; index < models.length; index++) {
    const entry = models[index];
    const model = getComboModelName(entry);
    if (typeof model !== "string" || model.trim().length === 0) {
      return `Model at index ${index} must be a non-empty string`;
    }

    if (typeof entry !== "string") {
      const weight = entry?.weight ?? 1;
      if (!Number.isSafeInteger(weight) || weight < 0) {
        return `Weight at index ${index} must be a non-negative integer`;
      }
    }
  }

  return null;
}
