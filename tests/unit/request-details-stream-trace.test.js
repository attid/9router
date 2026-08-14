import { beforeEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb", () => ({
  appendRequestLog: vi.fn(async () => {}),
  getRequestDetailById: vi.fn(),
  trackPendingRequest: vi.fn(),
}));

import { getRequestDetailById } from "@/lib/usageDb";

async function runPassthrough(raw) {
  let completion;
  const transform = createSSEStream({
    mode: "passthrough",
    sourceFormat: FORMATS.OPENAI,
    provider: "openai",
    model: "gpt-test",
    onStreamComplete: (content, usage) => { completion = { content, usage }; },
  });
  const response = new Response(raw).body.pipeThrough(transform);
  await new Response(response).text();
  return completion;
}

describe("bounded request-details stream capture", () => {
  it("captures both provider and client SSE for a real passthrough stream", async () => {
    const raw = [
      'data: {"choices":[{"delta":{"content":"hello"}}]}',
      'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
      "data: [DONE]",
      "",
    ].join("\n");

    const completion = await runPassthrough(raw);
    const provider = Buffer.from(completion.content.meta.providerSseBase64, "base64").toString("utf8");
    const client = Buffer.from(completion.content.meta.clientSseBase64, "base64").toString("utf8");

    expect(provider).toContain('"content":"hello"');
    expect(client).toContain('"content":"hello"');
    expect(completion.content.meta.truncated).toBe(false);
  });

  it("bounds oversized provider and client traces and marks them truncated", async () => {
    const chunks = Array.from({ length: 80 }, (_, index) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: `${index}-${"x".repeat(100)}` } }] })}\n\n`
    ).join("");

    const completion = await runPassthrough(`${chunks}data: [DONE]\n\n`);
    const providerBytes = Buffer.from(completion.content.meta.providerSseBase64, "base64");
    const clientBytes = Buffer.from(completion.content.meta.clientSseBase64, "base64");

    expect(providerBytes.byteLength).toBeLessThanOrEqual(completion.content.meta.maxBytesPerSide);
    expect(clientBytes.byteLength).toBeLessThanOrEqual(completion.content.meta.maxBytesPerSide);
    expect(completion.content.meta.truncated).toBe(true);
  });

  it("does not re-encode one huge provider chunk just to truncate its trace", async () => {
    const hugeBytes = new TextEncoder().encode(`data: ${"x".repeat(256 * 1024)}\n`);
    const encodedLengths = [];
    const originalEncode = TextEncoder.prototype.encode;
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode").mockImplementation(function encode(value) {
      encodedLengths.push(value?.length || 0);
      return originalEncode.call(this, value);
    });
    let completion;
    const transform = createSSEStream({
      mode: "passthrough",
      sourceFormat: FORMATS.OPENAI,
      provider: "openai",
      model: "gpt-test",
      onStreamComplete: (content) => { completion = content; },
    });

    try {
      const writer = transform.writable.getWriter();
      const outputPromise = new Response(transform.readable).text();
      await writer.write(hugeBytes);
      await writer.close();
      await outputPromise;
    } finally {
      encodeSpy.mockRestore();
    }

    expect(Math.max(...encodedLengths)).toBeLessThan(hugeBytes.byteLength);
    expect(Buffer.from(completion.meta.providerSseBase64, "base64").byteLength)
      .toBeLessThanOrEqual(completion.meta.maxBytesPerSide);
    expect(completion.meta.truncated).toBe(true);
  });
});

describe("request-details stream trace decoder", () => {
  let decodeRequestDetailStreamTrace;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ decodeRequestDetailStreamTrace } = await import("../../src/lib/requestDetailsStreamTrace.js"));
  });

  it("decodes provider/client events, tools, errors, and truncation metadata", () => {
    const provider = [
      "event: content_block_start",
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tool-1","name":"Read","input":{"file":"a.txt"}}}',
      "",
      "event: error",
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      "",
    ].join("\n");
    const detail = {
      streamTrace: {
        providerSseBase64: Buffer.from(provider).toString("base64"),
        clientSseBase64: Buffer.from("data: [DONE]\n\n").toString("base64"),
        truncated: true,
        maxBytesPerSide: 1024,
      },
    };

    const decoded = decodeRequestDetailStreamTrace(detail);

    expect(decoded.available).toBe(true);
    expect(decoded.truncated).toBe(true);
    expect(decoded.tools).toEqual([{ id: "tool-1", name: "Read", input: { file: "a.txt" } }]);
    expect(decoded.errors).toEqual([{ type: "overloaded_error", message: "Overloaded" }]);
    expect(decoded.events.map((event) => event.source)).toEqual(["provider", "provider", "client"]);
  });

  it("rejects malformed base64 instead of decoding garbage", () => {
    expect(decodeRequestDetailStreamTrace({ streamTrace: { providerSseBase64: "%%%" } })).toMatchObject({
      available: false,
      events: [],
    });
  });

  it("extracts OpenAI and Responses tool calls", () => {
    const provider = [
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"search","arguments":"{}"}}]}}]}',
      "",
      'event: response.output_item.added',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call-2","name":"read","arguments":"{\\"path\\":\\"a.txt\\"}"}}',
      "",
    ].join("\n");

    const decoded = decodeRequestDetailStreamTrace({
      streamTrace: { providerSseBase64: Buffer.from(provider).toString("base64") },
    });

    expect(decoded.tools).toEqual([
      { id: "call-1", name: "search", input: {} },
      { id: "call-2", name: "read", input: { path: "a.txt" } },
    ]);
  });
});

describe("GET /api/usage/request-details/[id]/stream-trace", () => {
  let GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GET } = await import("../../src/app/api/usage/request-details/[id]/stream-trace/route.js"));
  });

  it("decodes a stored trace on demand", async () => {
    vi.mocked(getRequestDetailById).mockResolvedValue({
      id: "request-1",
      streamTrace: {
        providerSseBase64: Buffer.from('data: {"type":"message_start"}\n\n').toString("base64"),
      },
    });

    const response = await GET(new Request("http://localhost/api/usage/request-details/request-1/stream-trace"), {
      params: Promise.resolve({ id: "request-1" }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).events[0]).toMatchObject({ source: "provider", event: "message" });
  });

  it("returns 404 for a missing request detail", async () => {
    vi.mocked(getRequestDetailById).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/usage/request-details/missing/stream-trace"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});
