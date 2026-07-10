import { getApiKeyByValue } from "@/lib/localDb.js";
import { getUsageByApiKey, statsEmitter } from "@/lib/usageDb.js";

export function getHourStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), 0, 0, 0);
}

export function getDayStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function getWeekStart(date = new Date()) {
  const start = getDayStart(date);
  const daysSinceMonday = start.getDay() === 0 ? 6 : start.getDay() - 1;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

function periodStarts(date = new Date()) {
  return {
    hourly: getHourStart(date).getTime(),
    daily: getDayStart(date).getTime(),
    weekly: getWeekStart(date).getTime(),
  };
}

function usageTokens(entry) {
  const tokens = entry?.tokens || {};
  return (tokens.prompt_tokens ?? tokens.input_tokens ?? 0)
    + (tokens.completion_tokens ?? tokens.output_tokens ?? 0);
}

if (!global._apiKeyLimitCounters) global._apiKeyLimitCounters = new Map();
export const counters = global._apiKeyLimitCounters;

async function loadCounters(apiKey, starts, target = null) {
  const [hourly, daily, weekly] = await Promise.all([
    getUsageByApiKey(apiKey, new Date(starts.hourly), { meteredOnly: true }),
    getUsageByApiKey(apiKey, new Date(starts.daily), { meteredOnly: true }),
    getUsageByApiKey(apiKey, new Date(starts.weekly), { meteredOnly: true }),
  ]);
  const entry = target || {};
  entry.hourly = { periodStart: starts.hourly, total: hourly };
  entry.daily = { periodStart: starts.daily, total: daily };
  entry.weekly = { periodStart: starts.weekly, total: weekly };
  counters.set(apiKey, entry);
  return entry;
}

async function ensureCounters(apiKey) {
  const starts = periodStarts();
  const entry = counters.get(apiKey);
  if (!entry) return loadCounters(apiKey, starts);

  const rolledOver = Object.entries(starts).some(
    ([period, start]) => entry[period]?.periodStart !== start,
  );
  return rolledOver ? loadCounters(apiKey, starts, entry) : entry;
}

if (!global._apiKeyLimitUsageListener) {
  global._apiKeyLimitUsageListener = (usageEntry) => {
    if (!usageEntry?.apiKey || usageEntry.metered === false) return;
    const entry = global._apiKeyLimitCounters.get(usageEntry.apiKey);
    if (!entry) return;

    const tokens = usageTokens(usageEntry);
    if (tokens <= 0) return;
    const starts = periodStarts(usageEntry.timestamp ? new Date(usageEntry.timestamp) : new Date());
    for (const period of ["hourly", "daily", "weekly"]) {
      if (entry[period]?.periodStart === starts[period]) entry[period].total += tokens;
    }
  };
  statsEmitter.on("usage", global._apiKeyLimitUsageListener);
}

function nextPeriodStart(period, periodStart) {
  const next = new Date(periodStart);
  if (period === "hourly") next.setHours(next.getHours() + 1);
  if (period === "daily") next.setDate(next.getDate() + 1);
  if (period === "weekly") next.setDate(next.getDate() + 7);
  return next;
}

function positiveLimit(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export async function checkKeyLimits(apiKey) {
  if (!apiKey) return { allowed: true };
  const config = await getApiKeyByValue(apiKey);
  const limits = config?.limits || {};
  if (![limits.hourly, limits.daily, limits.weekly].some(positiveLimit)) return { allowed: true };

  const usage = await ensureCounters(apiKey);
  for (const period of ["hourly", "daily", "weekly"]) {
    const limit = limits[period];
    if (!positiveLimit(limit) || usage[period].total < limit) continue;
    const retryAfter = Math.max(1, Math.ceil((nextPeriodStart(period, usage[period].periodStart) - new Date()) / 1000));
    return {
      allowed: false,
      error: `API key token limit exceeded: ${period} limit of ${limit} tokens reached (used: ${usage[period].total})`,
      retryAfter,
    };
  }
  return { allowed: true };
}

export async function getKeyUsageStats(apiKey) {
  const [config, usage] = await Promise.all([
    getApiKeyByValue(apiKey),
    ensureCounters(apiKey),
  ]);
  const limits = config?.limits || {};
  return {
    hourly: { used: usage.hourly.total, limit: limits.hourly || null },
    daily: { used: usage.daily.total, limit: limits.daily || null },
    weekly: { used: usage.weekly.total, limit: limits.weekly || null },
  };
}
