import { describe, expect, it, vi } from "vitest";
import {
  detectStreamingPreludeError,
  handleStreamingResponse,
} from "../../open-sse/handlers/chatCore/streamingHandler.js";

describe("detectStreamingPreludeError", () => {
  it("detects claude SSE error event before any text output", () => {
    const raw = [
      "event: message_start",
      'data: {"type":"message_start"}',
      "",
      "event: error",
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      "",
    ].join("\n");

    const result = detectStreamingPreludeError(raw);

    expect(result).toEqual({
      statusCode: 529,
      message: "Overloaded",
      errorType: "overloaded_error",
    });
  });

  it("does not report an error after assistant text has already started", () => {
    const raw = [
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"text":"Hi"}}',
      "",
      "event: error",
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      "",
    ].join("\n");

    const result = detectStreamingPreludeError(raw);

    expect(result).toBeNull();
  });
});

describe("handleStreamingResponse", () => {
  it("returns an error result when the stream starts with provider SSE error", async () => {
    const providerResponse = new Response(
      [
        "event: error",
        'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
        "",
      ].join("\n"),
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }
    );

    const result = await handleStreamingResponse({
      providerResponse,
      provider: "claude",
      model: "claude-sonnet-4-6",
      sourceFormat: "openai",
      targetFormat: "claude",
      userAgent: "test",
      body: { stream: true },
      stream: true,
      translatedBody: null,
      finalBody: null,
      requestStartTime: Date.now(),
      connectionId: "conn-1",
      apiKey: null,
      clientRawRequest: null,
      onRequestSuccess: vi.fn(),
      reqLogger: null,
      toolNameMap: null,
      onStreamComplete: vi.fn(),
      streamController: {
        handleError: vi.fn(),
      },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(529);
    expect(result.error).toBe("Overloaded");
  });
});
