/**
 * Shared combo (model combo) handling with weighted round-robin + fallback
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";

// In-memory round-robin counters: comboName → index
const rrCounters = new Map();

/**
 * Build weighted cycle array from models with weight > 0.
 * E.g. [{model:"A", weight:2}, {model:"B", weight:1}] → ["A", "A", "B"]
 */
export function buildWeightedCycle(models) {
  const cycle = [];
  for (const m of models) {
    for (let i = 0; i < (m.weight || 0); i++) {
      cycle.push(m.model);
    }
  }
  return cycle;
}

/**
 * Pick next model from cycle using round-robin counter.
 */
export function pickNextModel(comboName, cycle, counters = rrCounters) {
  const idx = counters.get(comboName) || 0;
  const model = cycle[idx % cycle.length];
  counters.set(comboName, idx + 1);
  return model;
}

/**
 * Get combo models from combos data (backward compatible).
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {{model: string, weight: number}[]|null} Array of model objects or null
 */
export function getComboModelsFromData(modelStr, combosData) {
  if (modelStr.includes("/")) return null;

  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models.map(m =>
      typeof m === "string" ? { model: m, weight: 1 } : { model: m.model, weight: m.weight ?? 1 }
    );
  }
  return null;
}

/**
 * Handle combo chat with weighted round-robin + fallback.
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {{model: string, weight: number}[]} options.models - Array of model objects
 * @param {string} [options.comboName] - Combo name (for round-robin counter)
 * @param {Function} options.handleSingleModel - (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger
 */
export async function handleComboChat({ body, models, comboName, handleSingleModel, log }) {
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  // Split into balanced pool and fallback list
  const balancePool = models.filter(m => m.weight > 0);
  const fallbackList = models.filter(m => m.weight === 0);

  // Build ordered try-list
  const tryList = [];

  if (balancePool.length > 0 && comboName) {
    const cycle = buildWeightedCycle(balancePool);
    if (cycle.length > 0) {
      const picked = pickNextModel(comboName, cycle);
      // Start with picked, then other pool models, then fallback
      tryList.push(picked);
      for (const m of balancePool) {
        if (m.model !== picked && !tryList.includes(m.model)) {
          tryList.push(m.model);
        }
      }
    }
  }

  // If no balanced models (all weight 0, or no comboName), use all models in order
  if (tryList.length === 0) {
    for (const m of models) {
      tryList.push(m.model);
    }
  } else {
    // Add fallback models at the end
    for (const m of fallbackList) {
      tryList.push(m.model);
    }
  }

  for (let i = 0; i < tryList.length; i++) {
    const modelStr = tryList[i];
    log.info("COMBO", `Trying model ${i + 1}/${tryList.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);

      if (result.ok) {
        log.info("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

      let errorText = result.statusText || "";
      let retryAfter = null;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
      } catch {
        // Ignore JSON parse errors
      }

      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      const { shouldFallback } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  const status = 406;
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}
