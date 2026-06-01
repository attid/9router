/**
 * Shared combo (model combo) handling with weighted round-robin + fallback
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const existingState = comboRotationState.get(rotationKey);
  const state = typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

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
 * Pick next model from weighted cycle using the existing combo rotation state.
 */
export function pickNextModel(comboName, cycle, stickyLimit = 1) {
  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const state = comboRotationState.get(rotationKey) || { index: 0, consecutiveUseCount: 0 };
  const currentIndex = state.index % cycle.length;
  const model = cycle[currentIndex];
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % cycle.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

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
 * @param {(string|{model: string, weight?: number})[]} options.models - Array of model definitions
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" or "round-robin"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1 }) {
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  const normalizedModels = (models || []).map((entry) =>
    typeof entry === "string"
      ? { model: entry, weight: 1 }
      : { model: entry.model, weight: entry.weight ?? 1 }
  );

  // Split into balanced pool and fallback list
  const balancePool = normalizedModels.filter((m) => m.weight > 0);
  const fallbackList = normalizedModels.filter((m) => m.weight === 0);

  // Build ordered try-list
  const tryList = [];

  if (comboStrategy === "round-robin" && balancePool.length > 0) {
    const cycle = buildWeightedCycle(balancePool);
    if (cycle.length > 0) {
      const picked = pickNextModel(comboName, cycle, comboStickyLimit);
      // Start with picked, then other pool models, then fallback
      tryList.push(picked);
      for (const m of balancePool) {
        if (m.model !== picked && !tryList.includes(m.model)) {
          tryList.push(m.model);
        }
      }
    }
  }

  // If no weighted round-robin selection applied, use the models in declared order.
  if (tryList.length === 0) {
    for (const m of normalizedModels) {
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

      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
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

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
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
