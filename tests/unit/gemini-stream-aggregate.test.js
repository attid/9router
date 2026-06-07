import { describe, it, expect } from "vitest";

import { aggregateGeminiSSE } from "../../open-sse/translator/helpers/geminiStreamAggregate.js";

describe("aggregateGeminiSSE — collapse Gemini SSE into one GenerateContentResponse", () => {
  it("concatenates text parts and carries finishReason + usage + modelVersion", () => {
    const sse = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hel"}]},"index":0}]}',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"lo"}]},"index":0}]}',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":""}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5},"modelVersion":"gpt-4o"}',
    ].join("\r\n\r\n");

    const result = aggregateGeminiSSE(sse);

    expect(result.candidates[0].content.parts).toEqual([{ text: "Hello" }]);
    expect(result.candidates[0].finishReason).toBe("STOP");
    expect(result.candidates[0].content.role).toBe("model");
    expect(result.usageMetadata).toEqual({ promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 });
    expect(result.modelVersion).toBe("gpt-4o");
  });

  it("preserves functionCall parts as separate entries", () => {
    const sse = [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"read_file","args":{"path":"/x"},"id":"c1"}}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}',
    ].join("");

    const result = aggregateGeminiSSE(sse);

    expect(result.candidates[0].content.parts).toEqual([
      { functionCall: { name: "read_file", args: { path: "/x" }, id: "c1" } },
    ]);
    expect(result.candidates[0].finishReason).toBe("STOP");
  });
});
