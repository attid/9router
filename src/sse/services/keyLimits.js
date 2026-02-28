import { getApiKeyByValue } from "@/lib/localDb";
import { getUsageByApiKey, statsEmitter } from "@/lib/usageDb";

const CACHE_TTL_MS = 30_000; // 30 seconds

// Cache: apiKeyValue → { hourly, daily, weekly, cachedAt }
const usageCache = new Map();

// Invalidate cache on new usage data
statsEmitter.on("update", () => {
  usageCache.clear();
});

/**
 * Check if an API key has exceeded its token limits.
 * @param {string} apiKeyValue - The raw API key string (e.g., "sk-...")
 * @returns {Promise<{allowed: boolean, error?: string, retryAfter?: number}>}
 */
export async function checkKeyLimits(apiKeyValue) {
  if (!apiKeyValue) return { allowed: true };

  // Look up key config
  const keyConfig = await getApiKeyByValue(apiKeyValue);
  if (!keyConfig?.limits) return { allowed: true };

  const { hourly, daily, weekly } = keyConfig.limits;

  // Skip if no limits set
  const hasLimits = (hourly && hourly > 0) || (daily && daily > 0) || (weekly && weekly > 0);
  if (!hasLimits) return { allowed: true };

  // Check cache
  const now = Date.now();
  const cached = usageCache.get(apiKeyValue);
  let usage;

  if (cached && (now - cached.cachedAt) < CACHE_TTL_MS) {
    usage = cached;
  } else {
    // Aggregate from usage.json
    const nowDate = new Date();
    const [usageHourly, usageDaily, usageWeekly] = await Promise.all([
      hourly && hourly > 0 ? getUsageByApiKey(apiKeyValue, new Date(nowDate - 3600_000)) : Promise.resolve(0),
      daily && daily > 0 ? getUsageByApiKey(apiKeyValue, new Date(nowDate - 86400_000)) : Promise.resolve(0),
      weekly && weekly > 0 ? getUsageByApiKey(apiKeyValue, new Date(nowDate - 604800_000)) : Promise.resolve(0),
    ]);

    usage = { hourly: usageHourly, daily: usageDaily, weekly: usageWeekly, cachedAt: now };
    usageCache.set(apiKeyValue, usage);
  }

  // Check limits
  if (hourly && hourly > 0 && usage.hourly >= hourly) {
    return {
      allowed: false,
      error: `API key token limit exceeded: hourly limit of ${hourly} tokens reached (used: ${usage.hourly})`,
      retryAfter: 3600,
    };
  }
  if (daily && daily > 0 && usage.daily >= daily) {
    return {
      allowed: false,
      error: `API key token limit exceeded: daily limit of ${daily} tokens reached (used: ${usage.daily})`,
      retryAfter: 86400,
    };
  }
  if (weekly && weekly > 0 && usage.weekly >= weekly) {
    return {
      allowed: false,
      error: `API key token limit exceeded: weekly limit of ${weekly} tokens reached (used: ${usage.weekly})`,
      retryAfter: 604800,
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

  const nowDate = new Date();
  const [usageHourly, usageDaily, usageWeekly] = await Promise.all([
    getUsageByApiKey(apiKeyValue, new Date(nowDate - 3600_000)),
    getUsageByApiKey(apiKeyValue, new Date(nowDate - 86400_000)),
    getUsageByApiKey(apiKeyValue, new Date(nowDate - 604800_000)),
  ]);

  return {
    hourly: { used: usageHourly, limit: limits.hourly || null },
    daily: { used: usageDaily, limit: limits.daily || null },
    weekly: { used: usageWeekly, limit: limits.weekly || null },
  };
}
