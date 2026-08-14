import { beforeEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

const { saveRequestDetail } = vi.hoisted(() => ({
  saveRequestDetail: vi.fn(async () => {}),
}));

vi.mock("@/lib/usageDb", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail,
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";
import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";

const base = {
  provider: "openai",
  model: "gpt-test",
  body: { model: "gpt-test" },
  stream: true,
  translatedBody: { model: "gpt-test" },
  finalBody: null,
  requestStartTime: Date.now(),
  connectionId: "connection-1",
  apiKey: "sk-client-secret",
  clientRawRequest: { endpoint: "/v1/chat/completions" },
  providerUrl: "https://provider.example/v1/chat/completions",
};

describe("request-details early streaming error paths", () => {
  beforeEach(() => saveRequestDetail.mockClear());

  it("records non-SSE upstream streaming failures with observability metadata", async () => {
    const result = await handleStreamingResponse({
      ...base,
      providerResponse: new Response("<title>Bad gateway</title>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      streamController: { handleError: vi.fn() },
    });

    expect(result.success).toBe(false);
    expect(saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "sk-client-secret",
      clientEndpoint: "/v1/chat/completions",
      providerUrl: "https://provider.example/v1/chat/completions",
      status: "error",
    }));
  });

  it("records invalid forced SSE-to-JSON failures with observability metadata", async () => {
    const result = await handleForcedSSEToJson({
      ...base,
      providerResponse: new Response("not valid SSE", {
        headers: { "content-type": "text/event-stream" },
      }),
      sourceFormat: FORMATS.OPENAI,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: "sk-client-secret",
      clientEndpoint: "/v1/chat/completions",
      providerUrl: "https://provider.example/v1/chat/completions",
      status: "error",
    }));
  });

  it("replaces the success placeholder with an error and bounded trace when a stream breaks mid-flight", async () => {
    const encoder = new TextEncoder();
    let sent = false;
    const providerBody = new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
          return;
        }
        controller.error(new Error("upstream exploded"));
      },
    });
    const streamController = createStreamController({ provider: "openai", model: "gpt-test" });

    const result = await handleStreamingResponse({
      ...base,
      providerResponse: new Response(providerBody, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      streamController,
      streamDetailId: "stream-error-1",
    });
    await new Response(result.response.body).text().catch(() => {});

    expect(saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
      id: "stream-error-1",
      status: "error",
      streamTrace: expect.objectContaining({
        providerSseBase64: expect.any(String),
        maxBytesPerSide: expect.any(Number),
      }),
    }));
  });

  it("replaces the success placeholder with a cancelled terminal detail on downstream cancellation", async () => {
    const encoder = new TextEncoder();
    const providerBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      },
    });
    const streamController = createStreamController({ provider: "openai", model: "gpt-test" });
    const result = await handleStreamingResponse({
      ...base,
      providerResponse: new Response(providerBody, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      streamController,
      streamDetailId: "stream-cancelled-1",
    });
    const reader = result.response.body.getReader();
    await reader.read();
    await reader.cancel("client closed response");
    await vi.waitFor(() => {
      expect(saveRequestDetail).toHaveBeenCalledWith(expect.objectContaining({
        id: "stream-cancelled-1",
        status: "cancelled",
        streamTrace: expect.objectContaining({
          providerSseBase64: expect.any(String),
          maxBytesPerSide: expect.any(Number),
        }),
        response: expect.objectContaining({ status: 499 }),
      }));
    });
  });

  it.each(["transform", "flush"])("reports %s failures with the bounded transform trace", async (phase) => {
    const trace = {
      providerSseBase64: Buffer.from("bounded provider tail").toString("base64"),
      clientSseBase64: "",
      truncated: true,
      maxBytesPerSide: 1024,
    };
    const transform = new TransformStream({
      transform(chunk, controller) {
        if (phase === "transform") throw new Error("transform exploded");
        controller.enqueue(chunk);
      },
      flush() {
        if (phase === "flush") throw new Error("flush exploded");
      },
    });
    transform.getRequestDetailsTrace = () => trace;
    const failures = [];
    const responseBody = pipeWithDisconnect(
      new Response("data: {}\n\n"),
      transform,
      createStreamController({ provider: "openai", model: "gpt-test" }),
      null,
      10_000,
      (error, capturedTrace, terminal) => failures.push({ error, capturedTrace, terminal })
    );

    await new Response(responseBody).text().catch(() => {});

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      error: { message: `${phase} exploded` },
      capturedTrace: trace,
      terminal: { status: "error" },
    });
  });
});
