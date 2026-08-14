import { describe, expect, it } from "vitest";

import { aggregateGeminiSSE } from "../../open-sse/translator/helpers/geminiStreamAggregate.js";

describe("aggregateGeminiSSE", () => {
  it("concatenates text and preserves response metadata", () => {
    const sse = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hel"}]},"index":0}]}',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"lo"}]},"index":0}]}',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":""}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5},"modelVersion":"gpt-4o"}',
    ].join("\r\n\r\n");

    const result = aggregateGeminiSSE(sse);

    expect(result.candidates[0].content.parts).toEqual([{ text: "Hello" }]);
    expect(result.candidates[0].finishReason).toBe("STOP");
    expect(result.usageMetadata).toEqual({
      promptTokenCount: 3,
      candidatesTokenCount: 2,
      totalTokenCount: 5,
    });
    expect(result.modelVersion).toBe("gpt-4o");
  });

  it("preserves function calls as separate parts", () => {
    const sse = 'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"read_file","args":{"path":"/x"},"id":"c1"}}]},"finishReason":"STOP","index":0}]}';

    const result = aggregateGeminiSSE(sse);

    expect(result.candidates[0].content.parts).toEqual([
      { functionCall: { name: "read_file", args: { path: "/x" }, id: "c1" } },
    ]);
  });
});
