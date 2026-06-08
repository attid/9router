import { register } from "../index.js";
import { FORMATS } from "../formats.js";

// Map OpenAI finish_reason -> Gemini finishReason
function mapFinishReason(reason) {
  switch (reason) {
    case "length": return "MAX_TOKENS";
    case "content_filter": return "SAFETY";
    case "stop":
    case "tool_calls":
    default: return "STOP";
  }
}

// Build a Gemini SSE chunk from a set of parts (+ optional finishReason/usage)
function geminiChunk(parts, { finishReason, usageMetadata } = {}) {
  const candidate = { content: { role: "model", parts }, index: 0 };
  if (finishReason) candidate.finishReason = finishReason;
  const chunk = { candidates: [candidate] };
  if (usageMetadata) chunk.usageMetadata = usageMetadata;
  return chunk;
}

function buildUsageMetadata(usage) {
  if (!usage) return null;
  const meta = {
    promptTokenCount: usage.prompt_tokens || 0,
    candidatesTokenCount: usage.completion_tokens || 0,
    totalTokenCount: usage.total_tokens || 0,
  };
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  if (reasoning) meta.thoughtsTokenCount = reasoning;
  return meta;
}

// Collect buffered tool calls (accumulated across deltas) into Gemini functionCall parts
function drainToolCalls(state) {
  if (!state.toolCalls || state.toolCalls.size === 0) return [];
  const parts = [];
  for (const tc of state.toolCalls.values()) {
    let args = {};
    if (tc.args) {
      try { args = JSON.parse(tc.args); } catch { args = {}; }
    }
    const functionCall = { name: tc.name, args };
    if (tc.id) functionCall.id = tc.id;
    // id ordering to match captured Gemini shape: id, args, name is cosmetic; keep name/args/id
    parts.push({ functionCall });
  }
  state.toolCalls.clear();
  return parts;
}

/**
 * Convert an OpenAI streaming chunk into Gemini GenerateContentResponse chunks.
 * Returns an array of Gemini chunks, or null when there is nothing to emit.
 *
 * chunk === null is the flush signal from the stream pipeline.
 */
export function openaiToGeminiResponse(chunk, state) {
  // Flush: emit the finish chunk if it was never sent (provider closed without finish_reason)
  if (chunk === null) {
    if (state.finishReasonSent) return null;
    const toolParts = drainToolCalls(state);
    if (toolParts.length === 0 && !state.finishReason) return null;
    state.finishReasonSent = true;
    return [geminiChunk(toolParts.length > 0 ? toolParts : [{ text: "" }], {
      finishReason: mapFinishReason(state.finishReason || "stop"),
      usageMetadata: buildUsageMetadata(state.usage),
    })];
  }

  const choice = chunk.choices?.[0];
  // Usage-only trailing chunk (no choices) — stash usage for the finish chunk
  if (!choice) {
    if (chunk.usage) state.usage = chunk.usage;
    return null;
  }

  const delta = choice.delta || {};
  const results = [];

  // Streamed text / reasoning
  const textParts = [];
  if (delta.reasoning_content) textParts.push({ text: delta.reasoning_content, thought: true });
  if (delta.content) textParts.push({ text: delta.content });
  if (textParts.length > 0) results.push(geminiChunk(textParts));

  // Accumulate streamed tool_calls by index
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const key = tc.index ?? tc.id ?? state.toolCalls.size;
      const existing = state.toolCalls.get(key) || { id: null, name: "", args: "" };
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name = tc.function.name;
      if (tc.function?.arguments) existing.args += tc.function.arguments;
      state.toolCalls.set(key, existing);
    }
  }

  if (chunk.usage) state.usage = chunk.usage;

  // Finish: emit any buffered tool calls + finishReason + usage
  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
    const toolParts = drainToolCalls(state);
    state.finishReasonSent = true;
    results.push(geminiChunk(toolParts.length > 0 ? toolParts : [{ text: "" }], {
      finishReason: mapFinishReason(choice.finish_reason),
      usageMetadata: buildUsageMetadata(state.usage),
    }));
  }

  return results.length > 0 ? results : null;
}

register(FORMATS.OPENAI, FORMATS.GEMINI, null, openaiToGeminiResponse);
register(FORMATS.OPENAI, FORMATS.GEMINI_CLI, null, openaiToGeminiResponse);
