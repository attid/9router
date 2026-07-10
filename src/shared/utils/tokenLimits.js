const PERIODS = ["hourly", "daily", "weekly"];

function normalizeLimit(value, period) {
  if (value === null || value === undefined || value === "" || value === 0 || value === "0") return null;
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`${period} token limit must be a non-negative integer or null`);
  }
  return parsed;
}

export function normalizeTokenLimits(limits, { partial = false } = {}) {
  if (limits === null || limits === undefined) return null;
  if (typeof limits !== "object" || Array.isArray(limits)) {
    throw new TypeError("limits must be an object or null");
  }

  const normalized = {};
  for (const period of PERIODS) {
    if (partial && !Object.hasOwn(limits, period)) continue;
    normalized[period] = normalizeLimit(limits[period], period);
  }
  return normalized;
}
