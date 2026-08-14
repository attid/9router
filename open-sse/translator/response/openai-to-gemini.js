import { FORMATS } from "../formats.js";
import { register } from "../index.js";

function mapFinishReason(reason) {
  if (reason === "length") return "MAX_TOKENS";
  if (reason === "content_filter") return "SAFETY";
  return "STOP";
}

function buildUsageMetadata(usage) {
  if (!usage) return null;

  const metadata = {
    promptTokenCount: usage.prompt_tokens || 0,
    candidatesTokenCount: usage.completion_tokens || 0,
    totalTokenCount: usage.total_tokens || 0,
  };
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
  if (reasoningTokens) metadata.thoughtsTokenCount = reasoningTokens;
  return metadata;
}

function createChunk(parts, { finishReason, usageMetadata } = {}) {
  const candidate = {
    content: { role: "model", parts },
    index: 0,
  };
  if (finishReason) candidate.finishReason = finishReason;

  const chunk = { candidates: [candidate] };
  if (usageMetadata) chunk.usageMetadata = usageMetadata;
  return chunk;
}

function drainToolCalls(state) {
  if (!state.toolCalls?.size) return [];

  const parts = [];
  for (const toolCall of state.toolCalls.values()) {
    let args = {};
    if (toolCall.args) {
      try {
        args = JSON.parse(toolCall.args);
      } catch {
        args = {};
      }
    }

    const functionCall = { name: toolCall.name, args };
    if (toolCall.id) functionCall.id = toolCall.id;
    parts.push({ functionCall });
  }
  state.toolCalls.clear();
  return parts;
}

export function openaiToGeminiResponse(chunk, state) {
  if (chunk === null) {
    if (state.finishReasonSent) return null;

    const toolParts = drainToolCalls(state);
    if (toolParts.length === 0 && !state.finishReason) return null;

    state.finishReasonSent = true;
    return [createChunk(toolParts.length > 0 ? toolParts : [{ text: "" }], {
      finishReason: mapFinishReason(state.finishReason || "stop"),
      usageMetadata: buildUsageMetadata(state.usage),
    })];
  }

  const choice = chunk.choices?.[0];
  if (!choice) {
    if (chunk.usage) state.usage = chunk.usage;
    return null;
  }

  const delta = choice.delta || {};
  const results = [];
  const textParts = [];
  if (delta.reasoning_content) {
    textParts.push({ text: delta.reasoning_content, thought: true });
  }
  if (delta.content) textParts.push({ text: delta.content });
  if (textParts.length > 0) results.push(createChunk(textParts));

  for (const toolCall of delta.tool_calls || []) {
    const key = toolCall.index ?? toolCall.id ?? state.toolCalls.size;
    const buffered = state.toolCalls.get(key) || { id: null, name: "", args: "" };
    if (toolCall.id) buffered.id = toolCall.id;
    if (toolCall.function?.name) buffered.name = toolCall.function.name;
    if (toolCall.function?.arguments) buffered.args += toolCall.function.arguments;
    state.toolCalls.set(key, buffered);
  }

  if (chunk.usage) state.usage = chunk.usage;

  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
    state.finishReasonSent = true;
    const toolParts = drainToolCalls(state);
    results.push(createChunk(toolParts.length > 0 ? toolParts : [{ text: "" }], {
      finishReason: mapFinishReason(choice.finish_reason),
      usageMetadata: buildUsageMetadata(state.usage),
    }));
  }

  return results.length > 0 ? results : null;
}

register(FORMATS.OPENAI, FORMATS.GEMINI, null, openaiToGeminiResponse);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, null, openaiToGeminiResponse);
