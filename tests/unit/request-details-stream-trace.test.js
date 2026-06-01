import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/usageDb", () => ({
  getRequestDetailById: vi.fn(),
}));

vi.mock("@/lib/requestDetailsStreamTrace", async () => {
  return await vi.importActual("../../src/lib/requestDetailsStreamTrace.js");
});

import { decodeRequestDetailStreamTrace } from "../../src/lib/requestDetailsStreamTrace.js";
import { getRequestDetailById } from "@/lib/usageDb";

describe("decodeRequestDetailStreamTrace", () => {
  it("extracts error and tool events from stored raw SSE", () => {
    const rawSse = [
      "event: content_block_start",
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file":"a.txt"}}}',
      "",
      "event: content_block_delta",
      'data: {"type":"content_block_delta","delta":{"partial_json":"{\\"file\\":\\"a.txt\\"}"}}',
      "",
      "event: error",
      'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      "",
    ].join("\n");

    const detail = {
      response: {
        meta: {
          raw_sse_b64: Buffer.from(rawSse, "utf8").toString("base64"),
          raw_sse_tail_b64: Buffer.from("data: [DONE]\n\n", "utf8").toString("base64"),
        },
      },
    };

    const trace = decodeRequestDetailStreamTrace(detail);

    expect(trace.available).toBe(true);
    expect(trace.events).toHaveLength(4);
    expect(trace.tools).toEqual([
      {
        id: "toolu_1",
        name: "Read",
        input: { file: "a.txt" },
      },
    ]);
    expect(trace.errors).toEqual([
      {
        type: "overloaded_error",
        message: "Overloaded",
      },
    ]);
  });
});

describe("GET /api/usage/request-details/[id]/stream-trace", () => {
  let GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../src/app/api/usage/request-details/[id]/stream-trace/route.js");
    GET = mod.GET;
  });

  it("returns decoded stream trace for a stored request detail", async () => {
    const rawSse = [
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","delta":"hello"}',
      "",
    ].join("\n");

    vi.mocked(getRequestDetailById).mockResolvedValue({
      id: "req-1",
      response: {
        meta: {
          raw_sse_b64: Buffer.from(rawSse, "utf8").toString("base64"),
          raw_sse_tail_b64: "",
        },
      },
    });

    const response = await GET(new Request("http://localhost/api/usage/request-details/req-1/stream-trace"), {
      params: Promise.resolve({ id: "req-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.events[0].event).toBe("response.output_text.delta");
    expect(body.events[0].summary).toContain("hello");
  });

  it("returns 404 when request detail is missing", async () => {
    vi.mocked(getRequestDetailById).mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/usage/request-details/missing/stream-trace"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Request detail not found");
  });
});
