import { getApiKeyByValue } from "@/lib/localDb.js";
import { getUsageByApiKey, statsEmitter } from "@/lib/usageDb.js";
import {
  getComboLimitCounterGeneration,
  getComboLimitCounters,
} from "@/shared/utils/comboLimitCounters.js";
import { getDayStart, getHourStart, getWeekStart } from "./keyLimits.js";

const PERIODS = ["hourly", "daily", "weekly"];

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

function positiveLimit(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getPairVersion(apiKey, comboId) {
  return global._comboLimitUsageVersions?.get(apiKey)?.get(comboId) || 0;
}

function incrementPairVersion(apiKey, comboId) {
  if (!global._comboLimitUsageVersions) global._comboLimitUsageVersions = new Map();
  let combos = global._comboLimitUsageVersions.get(apiKey);
  if (!combos) {
    combos = new Map();
    global._comboLimitUsageVersions.set(apiKey, combos);
  }
  combos.set(comboId, (combos.get(comboId) || 0) + 1);
}

export const counters = getComboLimitCounters();

async function loadCounters(apiKey, comboId, starts, target = null) {
  const generation = getComboLimitCounterGeneration(comboId);
  let totals;
  while (true) {
    const version = getPairVersion(apiKey, comboId);
    totals = await Promise.all(PERIODS.map((period) => (
      getUsageByApiKey(apiKey, new Date(starts[period]), { comboId })
    )));
    if (version === getPairVersion(apiKey, comboId)) break;
  }

  const entry = target || {};
  for (const [index, period] of PERIODS.entries()) {
    entry[period] = { periodStart: starts[period], total: totals[index] };
  }

  if (generation === getComboLimitCounterGeneration(comboId)) {
    let combos = counters.get(apiKey);
    if (!combos) {
      combos = new Map();
      counters.set(apiKey, combos);
    }
    combos.set(comboId, entry);
  }
  return entry;
}

async function ensureCounters(apiKey, comboId) {
  const starts = periodStarts();
  const entry = counters.get(apiKey)?.get(comboId);
  if (!entry) return loadCounters(apiKey, comboId, starts);

  const rolledOver = PERIODS.some((period) => entry[period]?.periodStart !== starts[period]);
  return rolledOver ? loadCounters(apiKey, comboId, starts, entry) : entry;
}

if (!global._comboLimitUsageListener) {
  global._comboLimitUsageListener = (usageEntry) => {
    if (!usageEntry?.apiKey || !Array.isArray(usageEntry.comboPath)) return;
    const tokens = usageTokens(usageEntry);
    if (tokens <= 0) return;

    const comboIds = new Set(usageEntry.comboPath.map((combo) => combo?.id).filter(Boolean));
    const starts = periodStarts(usageEntry.timestamp ? new Date(usageEntry.timestamp) : new Date());
    for (const comboId of comboIds) {
      incrementPairVersion(usageEntry.apiKey, comboId);
      const entry = counters.get(usageEntry.apiKey)?.get(comboId);
      if (!entry) continue;
      for (const period of PERIODS) {
        if (entry[period]?.periodStart === starts[period]) entry[period].total += tokens;
      }
    }
  };
  statsEmitter.on("usage", global._comboLimitUsageListener);
}

function nextPeriodStart(period, periodStart) {
  if (period === "hourly") return new Date(periodStart + 60 * 60 * 1000);
  const next = new Date(periodStart);
  next.setDate(next.getDate() + (period === "weekly" ? 7 : 1));
  return next;
}

export async function checkComboLimits(apiKey, combo) {
  if (!apiKey || !combo?.id) return { allowed: true };
  const limits = combo.limits || {};
  if (!PERIODS.some((period) => positiveLimit(limits[period]))) return { allowed: true };

  const [usage, apiKeyConfig] = await Promise.all([
    ensureCounters(apiKey, combo.id),
    getApiKeyByValue(apiKey),
  ]);
  for (const period of PERIODS) {
    const limit = limits[period];
    if (!positiveLimit(limit) || usage[period].total < limit) continue;
    const resetAt = nextPeriodStart(period, usage[period].periodStart);
    const retryAfter = Math.max(1, Math.ceil((resetAt - new Date()) / 1000));
    return {
      allowed: false,
      error: `Combo token limit exceeded: ${combo.name} ${period} limit of ${limit} tokens reached (used: ${usage[period].total})`,
      retryAfter,
      comboId: combo.id,
      comboName: combo.name,
      apiKeyId: apiKeyConfig?.id || null,
      apiKeyName: apiKeyConfig?.name || null,
      period,
      used: usage[period].total,
      limit,
      resetAt: resetAt.toISOString(),
    };
  }
  return { allowed: true };
}
