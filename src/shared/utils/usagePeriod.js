export const USAGE_PRESETS = ["today", "yesterday", "7d", "30d", "all"];
export const DEFAULT_USAGE_PRESET = "today";

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function normalizeUsagePreset(value) {
  return USAGE_PRESETS.includes(value) ? value : DEFAULT_USAGE_PRESET;
}

export function getUsageRange(preset, now = new Date()) {
  const normalized = normalizeUsagePreset(preset);
  const current = new Date(now);

  if (normalized === "today") {
    return {
      preset: normalized,
      start: startOfDay(current).toISOString(),
      end: current.toISOString(),
    };
  }

  if (normalized === "yesterday") {
    const y = new Date(current);
    y.setDate(y.getDate() - 1);
    return {
      preset: normalized,
      start: startOfDay(y).toISOString(),
      end: endOfDay(y).toISOString(),
    };
  }

  if (normalized === "7d" || normalized === "30d") {
    const days = normalized === "7d" ? 7 : 30;
    const start = new Date(current);
    start.setDate(start.getDate() - (days - 1));
    return {
      preset: normalized,
      start: startOfDay(start).toISOString(),
      end: current.toISOString(),
    };
  }

  return { preset: "all", start: null, end: null };
}

export function rangeIncludesNow(range, now = new Date()) {
  if (!range?.start || !range?.end) return true;
  const nowMs = new Date(now).getTime();
  const startMs = new Date(range.start).getTime();
  const endMs = new Date(range.end).getTime();
  return nowMs >= startMs && nowMs <= endMs;
}

export function buildUsageQuery(range) {
  const params = new URLSearchParams();
  if (range?.preset) params.set("preset", range.preset);
  if (range?.start) params.set("start", range.start);
  if (range?.end) params.set("end", range.end);
  return params.toString();
}
