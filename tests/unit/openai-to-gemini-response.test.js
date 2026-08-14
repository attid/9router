import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState } from "../../open-sse/translator/index.js";
import { openaiToGeminiResponse } from "../../open-sse/translator/response/openai-to-gemini.js";

const newState = () => initState(FORMATS.GEMINI);

describe("openaiToGeminiResponse", () => {
  it("converts text and reasoning deltas", () => {
    const output = openaiToGeminiResponse({
      choices: [{
        delta: { reasoning_content: "thinking", content: "answer" },
        finish_reason: null,
      }],
    }, newState());

    expect(output[0].candidates[0].content.parts).toEqual([
      { text: "thinking", thought: true },
      { text: "answer" },
    ]);
  });

  it("accumulates streamed tool calls", () => {
    const state = newState();
    openaiToGeminiResponse({
      choices: [{
        delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"file_path":' } }] },
        finish_reason: null,
      }],
    }, state);
    openaiToGeminiResponse({
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: '"/tmp/x"}' } }] },
        finish_reason: null,
      }],
    }, state);

    const output = openaiToGeminiResponse({
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }, state);

    expect(output[0].candidates[0]).toEqual({
      content: {
        role: "model",
        parts: [{
          functionCall: {
            id: "call_1",
            name: "read_file",
            args: { file_path: "/tmp/x" },
          },
        }],
      },
      finishReason: "STOP",
      index: 0,
    });
    expect(output[0].usageMetadata).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
  });

  it("does not emit the finish chunk twice", () => {
    const state = newState();
    openaiToGeminiResponse({
      choices: [{ delta: {}, finish_reason: "stop" }],
    }, state);

    expect(openaiToGeminiResponse(null, state)).toBeNull();
  });
});
