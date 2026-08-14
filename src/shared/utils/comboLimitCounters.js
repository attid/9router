function getCounters() {
  if (!global._comboLimitCounters) global._comboLimitCounters = new Map();
  return global._comboLimitCounters;
}

function getGenerations() {
  if (!global._comboLimitCounterGenerations) {
    global._comboLimitCounterGenerations = { epoch: 0, combos: new Map() };
  }
  return global._comboLimitCounterGenerations;
}

export function getComboLimitCounters() {
  return getCounters();
}

export function getComboLimitCounterGeneration(comboId) {
  const state = getGenerations();
  return `${state.epoch}:${state.combos.get(comboId) || 0}`;
}

export function invalidateComboLimitCounters(comboId = null) {
  const counters = getCounters();
  const generations = getGenerations();
  if (comboId) {
    for (const [apiKey, combos] of counters) {
      combos.delete(comboId);
      if (combos.size === 0) counters.delete(apiKey);
    }
    generations.combos.set(comboId, (generations.combos.get(comboId) || 0) + 1);
    return;
  }

  counters.clear();
  generations.epoch += 1;
  generations.combos.clear();
}
