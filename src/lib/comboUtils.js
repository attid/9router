/**
 * Normalize combo models array to {model, weight}[] format.
 * Handles both old (string[]) and new ({model, weight}[]) formats.
 * @param {Array} models - Array of strings or {model, weight} objects
 * @returns {{model: string, weight: number}[]}
 */
export function normalizeComboModels(models) {
  if (!Array.isArray(models)) return [];
  return models.map((entry) => {
    if (typeof entry === "string") {
      return { model: entry, weight: 1 };
    }
    return { model: entry.model, weight: entry.weight ?? 1 };
  });
}
