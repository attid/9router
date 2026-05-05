import { deriveSessionId } from "./sessionManager.js";

function normalizeThinking(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const type = value.type;
  if (type !== "enabled" && type !== "disabled") return undefined;
  return { type };
}

export function applyKimiRequestFields(body, connectionId) {
  const result = { ...body, prompt_cache_key: deriveSessionId(connectionId) };
  const effort = typeof result.reasoning_effort === "string"
    ? result.reasoning_effort
    : typeof result.reasoningEffort === "string"
      ? result.reasoningEffort
      : undefined;
  const explicitThinking = normalizeThinking(result.thinking);

  delete result.reasoningEffort;

  if (explicitThinking?.type === "disabled") {
    result.thinking = { type: "disabled" };
    delete result.reasoning_effort;
    return result;
  }

  if (effort === "auto") {
    delete result.reasoning_effort;
    delete result.thinking;
    return result;
  }

  if (effort === "off") {
    delete result.reasoning_effort;
    result.thinking = { type: "disabled" };
    return result;
  }

  if (effort) {
    result.reasoning_effort = effort;
    result.thinking = explicitThinking || { type: "enabled" };
    return result;
  }

  if (explicitThinking) {
    result.thinking = explicitThinking;
    return result;
  }

  delete result.reasoning_effort;
  delete result.thinking;
  return result;
}
