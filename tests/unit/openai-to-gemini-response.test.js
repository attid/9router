import { describe, it, expect } from "vitest";

import { initState } from "../../open-sse/translator/index.js";
import { openaiToGeminiResponse } from "../../open-sse/translator/response/openai-to-gemini.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const newState = () => initState(FORMATS.GEMINI);

describe("openaiToGeminiResponse — OpenAI SSE chunk -> Gemini candidates", () => {
  it("converts a text content delta into a Gemini text part", () => {
    const chunk = { choices: [{ delta: { content: "Hello" }, finish_reason: null }] };

    const out = openaiToGeminiResponse(chunk, newState());

    expect(out).toEqual([
      {
        candidates: [
          { content: { role: "model", parts: [{ text: "Hello" }] }, index: 0 },
        ],
      },
    ]);
  });

  it("marks reasoning_content deltas as thought parts", () => {
    const chunk = { choices: [{ delta: { reasoning_content: "thinking..." }, finish_reason: null }] };

    const out = openaiToGeminiResponse(chunk, newState());

    expect(out[0].candidates[0].content.parts).toEqual([
      { text: "thinking...", thought: true },
    ]);
  });

  it("emits finishReason and usageMetadata on the final chunk", () => {
    const chunk = {
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const out = openaiToGeminiResponse(chunk, newState());

    expect(out).toHaveLength(1);
    const cand = out[0].candidates[0];
    expect(cand.finishReason).toBe("STOP");
    expect(cand.content.parts).toEqual([{ text: "" }]);
    expect(out[0].usageMetadata).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
  });

  it("accumulates streamed tool_calls into a functionCall on finish", () => {
    const state = newState();

    openaiToGeminiResponse(
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"file_path":' } }] }, finish_reason: null }] },
      state
    );
    openaiToGeminiResponse(
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"/tmp/x"}' } }] }, finish_reason: null }] },
      state
    );
    const out = openaiToGeminiResponse(
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      state
    );

    const parts = out[0].candidates[0].content.parts;
    expect(parts).toEqual([
      { functionCall: { id: "call_1", name: "read_file", args: { file_path: "/tmp/x" } } },
    ]);
    expect(out[0].candidates[0].finishReason).toBe("STOP");
  });

  it("does not emit the finish chunk twice (idempotent on flush)", () => {
    const state = newState();
    openaiToGeminiResponse({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, state);

    const flushed = openaiToGeminiResponse(null, state);

    expect(flushed).toBeNull();
  });
});
