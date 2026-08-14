import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { COLORS } from "../../utils/stream.js";
import { canonicalizeUsage } from "../../utils/usageTracking.js";

const OPTIONAL_PARAMS = [
  "temperature", "top_p", "top_k",
  "max_tokens", "max_completion_tokens",
  "thinking", "reasoning", "enable_thinking",
  "presence_penalty", "frequency_penalty",
  "seed", "stop", "tools", "tool_choice",
  "response_format", "prediction", "store", "metadata",
  "n", "logprobs", "top_logprobs", "logit_bias",
  "user", "parallel_tool_calls"
];

export function extractRequestConfig(body, stream) {
  const config = { messages: body.messages || [], model: body.model, stream };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = body[param];
  }
  return config;
}

export function extractUsageFromResponse(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return null;

  // Claude format
  if (responseBody.usage?.input_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      cache_read_input_tokens: responseBody.usage.cache_read_input_tokens,
      cache_creation_input_tokens: responseBody.usage.cache_creation_input_tokens
    };
  }

  // OpenAI format
  if (responseBody.usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: responseBody.usage.prompt_tokens || 0,
      completion_tokens: responseBody.usage.completion_tokens || 0,
      cached_tokens: responseBody.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: responseBody.usage.completion_tokens_details?.reasoning_tokens
    };
  }

  // Gemini format
  if (responseBody.usageMetadata) {
    return {
      prompt_tokens: responseBody.usageMetadata.promptTokenCount || 0,
      completion_tokens: responseBody.usageMetadata.candidatesTokenCount || 0,
      cached_tokens: responseBody.usageMetadata.cachedContentTokenCount || 0,
      reasoning_tokens: responseBody.usageMetadata.thoughtsTokenCount || 0
    };
  }

  return null;
}

export function buildRequestDetail(base, overrides = {}) {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    apiKey: base.apiKey || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    clientEndpoint: base.clientEndpoint || null,
    providerUrl: base.providerUrl || null,
    streamTrace: base.streamTrace || null,
    response: base.response || {},
    status: base.status || "success",
    ...overrides
  };
}

export function saveComboLimitDetail({ action, usageMeta, limitCheck }) {
  return saveRequestDetail({
    provider: "combo",
    model: limitCheck.comboName,
    timestamp: new Date().toISOString(),
    status: action,
    eventType: "combo_limit",
    latency: {},
    tokens: {},
    request: {},
    response: {},
    routing: {
      rootModel: usageMeta?.requestedModel || limitCheck.comboName,
      comboPath: usageMeta?.comboPath || [],
      blockedCombo: { id: limitCheck.comboId, name: limitCheck.comboName },
    },
    apiKeyIdentity: {
      id: limitCheck.apiKeyId || null,
      name: limitCheck.apiKeyName || null,
    },
    limit: {
      period: limitCheck.period,
      used: limitCheck.used,
      limit: limitCheck.limit,
      retryAfter: limitCheck.retryAfter,
      resetAt: limitCheck.resetAt,
    },
  });
}

export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, usageMeta, label = "USAGE" }) {
  if (!tokens || typeof tokens !== "object") return;

  const inTokens = tokens.input_tokens ?? tokens.prompt_tokens ?? 0;
  const outTokens = tokens.output_tokens ?? tokens.completion_tokens ?? 0;

  if (inTokens === 0 && outTokens === 0) return;

  const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
  console.log(`${COLORS.green}[${time}] 📊 [${label}] ${provider.toUpperCase()} | in=${inTokens} | out=${outTokens}${accountSuffix}${COLORS.reset}`);

  // Canonicalize to one storage convention (prompt_tokens cache-inclusive) so
  // cached/cache-creation tokens survive to cost calc + stats. See canonicalizeUsage.
  const normalized = canonicalizeUsage(tokens) || {
    prompt_tokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
    completion_tokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0
  };

  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    ...(usageMeta?.startedAt ? { startedAt: usageMeta.startedAt } : {}),
    timestamp: usageMeta?.startedAt || new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null,
    ...(usageMeta?.requestedModel ? { requestedModel: usageMeta.requestedModel } : {}),
    ...(usageMeta && Object.hasOwn(usageMeta, "metered") ? { metered: usageMeta.metered } : {}),
    ...(usageMeta?.comboPath ? { comboPath: usageMeta.comboPath } : {}),
  }).catch(() => {});
}
