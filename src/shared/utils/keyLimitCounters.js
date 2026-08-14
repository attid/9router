function getCounters() {
  if (!global._apiKeyLimitCounters) global._apiKeyLimitCounters = new Map();
  return global._apiKeyLimitCounters;
}

function getGenerations() {
  if (!global._apiKeyLimitCounterGenerations) {
    global._apiKeyLimitCounterGenerations = { epoch: 0, keys: new Map() };
  }
  return global._apiKeyLimitCounterGenerations;
}

export function getKeyLimitCounters() {
  return getCounters();
}

export function getKeyLimitCounterGeneration(apiKey) {
  const state = getGenerations();
  return `${state.epoch}:${state.keys.get(apiKey) || 0}`;
}

export function invalidateKeyLimitCounters(apiKey = null) {
  const counters = getCounters();
  const generations = getGenerations();
  if (apiKey) {
    counters.delete(apiKey);
    generations.keys.set(apiKey, (generations.keys.get(apiKey) || 0) + 1);
  } else {
    counters.clear();
    generations.epoch += 1;
    generations.keys.clear();
  }
}
