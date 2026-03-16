import { getApiKeyByValue } from "@/lib/localDb";
import { getUsageByApiKey, statsEmitter } from "@/lib/usageDb";

// --- Calendar period helpers ---

function getHourStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), 0, 0, 0);
}

function getDayStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1; // Monday as first day
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function extractTokens(entry) {
  const input = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const output = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cacheRead = entry.tokens?.cache_read_input_tokens || entry.tokens?.cached_tokens || 0;
  const cacheCreation = entry.tokens?.cache_creation_input_tokens || 0;
  return input + cacheRead + cacheCreation + output;
}

// --- In-memory counters ---
// Map<apiKeyValue, { hourly: { periodStart, total }, daily: { periodStart, total }, weekly: { periodStart, total } }>
const counters = new Map();

/**
 * Ensure counters exist for a key and periods are current.
 * On first call or period rollover — loads from usage.json.
 */
async function ensureCounters(apiKeyValue) {
  const now = new Date();
  const hourStart = getHourStart(now).getTime();
  const dayStart = getDayStart(now).getTime();
  const weekStart = getWeekStart(now).getTime();

  let entry = counters.get(apiKeyValue);

  if (!entry) {
    // First access — load all periods from file
    const [h, d, w] = await Promise.all([
      getUsageByApiKey(apiKeyValue, new Date(hourStart)),
      getUsageByApiKey(apiKeyValue, new Date(dayStart)),
      getUsageByApiKey(apiKeyValue, new Date(weekStart)),
    ]);
    entry = {
      hourly:  { periodStart: hourStart, total: h },
      daily:   { periodStart: dayStart,  total: d },
      weekly:  { periodStart: weekStart, total: w },
    };
    counters.set(apiKeyValue, entry);
    return entry;
  }

  // Check for period rollovers
  let needReload = false;

  if (entry.hourly.periodStart !== hourStart) {
    entry.hourly.periodStart = hourStart;
    needReload = true;
  }
  if (entry.daily.periodStart !== dayStart) {
    entry.daily.periodStart = dayStart;
    needReload = true;
  }
  if (entry.weekly.periodStart !== weekStart) {
    entry.weekly.periodStart = weekStart;
    needReload = true;
  }

  if (needReload) {
    const [h, d, w] = await Promise.all([
      getUsageByApiKey(apiKeyValue, new Date(hourStart)),
      getUsageByApiKey(apiKeyValue, new Date(dayStart)),
      getUsageByApiKey(apiKeyValue, new Date(weekStart)),
    ]);
    entry.hourly.total = h;
    entry.daily.total = d;
    entry.weekly.total = w;
  }

  return entry;
}

// Increment counters when new usage is saved
statsEmitter.on("update", (usageEntry) => {
  if (usageEntry?.unmetered) return;
  if (!usageEntry?.apiKey) return;
  const entry = counters.get(usageEntry.apiKey);
  if (!entry) return; // key not tracked yet, will load on next check

  const tokens = extractTokens(usageEntry);
  if (tokens === 0) return;

  const now = new Date();

  // Only increment if still in the same period
  if (entry.hourly.periodStart === getHourStart(now).getTime()) {
    entry.hourly.total += tokens;
  }
  if (entry.daily.periodStart === getDayStart(now).getTime()) {
    entry.daily.total += tokens;
  }
  if (entry.weekly.periodStart === getWeekStart(now).getTime()) {
    entry.weekly.total += tokens;
  }
});

/**
 * Check if an API key has exceeded its token limits.
 * @param {string} apiKeyValue - The raw API key string (e.g., "sk-...")
 * @returns {Promise<{allowed: boolean, error?: string, retryAfter?: number}>}
 */
export async function checkKeyLimits(apiKeyValue) {
  if (!apiKeyValue) return { allowed: true };

  const keyConfig = await getApiKeyByValue(apiKeyValue);
  if (!keyConfig?.limits) return { allowed: true };

  const { hourly, daily, weekly } = keyConfig.limits;

  const hasLimits = (hourly && hourly > 0) || (daily && daily > 0) || (weekly && weekly > 0);
  if (!hasLimits) return { allowed: true };

  const usage = await ensureCounters(apiKeyValue);
  const now = new Date();

  if (hourly && hourly > 0 && usage.hourly.total >= hourly) {
    // Seconds until next hour
    const nextHour = new Date(usage.hourly.periodStart + 3600_000);
    const retryAfter = Math.ceil((nextHour - now) / 1000);
    return {
      allowed: false,
      error: `API key token limit exceeded: hourly limit of ${hourly} tokens reached (used: ${usage.hourly.total})`,
      retryAfter,
    };
  }
  if (daily && daily > 0 && usage.daily.total >= daily) {
    const nextDay = new Date(usage.daily.periodStart + 86400_000);
    const retryAfter = Math.ceil((nextDay - now) / 1000);
    return {
      allowed: false,
      error: `API key token limit exceeded: daily limit of ${daily} tokens reached (used: ${usage.daily.total})`,
      retryAfter,
    };
  }
  if (weekly && weekly > 0 && usage.weekly.total >= weekly) {
    const nextWeek = new Date(usage.weekly.periodStart + 7 * 86400_000);
    const retryAfter = Math.ceil((nextWeek - now) / 1000);
    return {
      allowed: false,
      error: `API key token limit exceeded: weekly limit of ${weekly} tokens reached (used: ${usage.weekly.total})`,
      retryAfter,
    };
  }

  return { allowed: true };
}

/**
 * Get current usage stats for a key (for dashboard display)
 * @param {string} apiKeyValue - The raw API key string
 * @returns {Promise<{hourly: {used, limit}, daily: {used, limit}, weekly: {used, limit}}>}
 */
export async function getKeyUsageStats(apiKeyValue) {
  const keyConfig = await getApiKeyByValue(apiKeyValue);
  const limits = keyConfig?.limits || {};

  const usage = await ensureCounters(apiKeyValue);

  return {
    hourly: { used: usage.hourly.total, limit: limits.hourly || null },
    daily:  { used: usage.daily.total,  limit: limits.daily || null },
    weekly: { used: usage.weekly.total, limit: limits.weekly || null },
  };
}

// Exported for testing
export { getHourStart, getDayStart, getWeekStart, counters };
