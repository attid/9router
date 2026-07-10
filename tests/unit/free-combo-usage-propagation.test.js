import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => mocks);

import { saveUsageStats } from "open-sse/handlers/chatCore/requestDetail.js";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue(undefined);
});

describe("usage write metadata", () => {
  it("writes metered=false and requestedModel while retaining canonical cached tokens", () => {
    saveUsageStats({
      provider: "anthropic",
      model: "claude-test",
      tokens: {
        input_tokens: 300,
        output_tokens: 40,
        cache_read_input_tokens: 100,
      },
      connectionId: "connection-1",
      apiKey: "sk-free-test",
      endpoint: "/v1/messages",
      usageMeta: { requestedModel: "free_combo", metered: false },
    });

    expect(mocks.saveRequestUsage).toHaveBeenCalledOnce();
    expect(mocks.saveRequestUsage.mock.calls[0][0]).toMatchObject({
      provider: "anthropic",
      model: "claude-test",
      apiKey: "sk-free-test",
      requestedModel: "free_combo",
      metered: false,
      tokens: {
        prompt_tokens: 400,
        completion_tokens: 40,
        cached_tokens: 100,
      },
    });
  });

  it("leaves ordinary writes metered by default", () => {
    saveUsageStats({
      provider: "openai",
      model: "paid-model",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      apiKey: "sk-paid-test",
    });

    const entry = mocks.saveRequestUsage.mock.calls[0][0];
    expect(entry).toMatchObject({ apiKey: "sk-paid-test" });
    expect(entry).not.toHaveProperty("requestedModel");
    expect(entry).not.toHaveProperty("metered");
  });
});

describe("all current chat-core usage paths", () => {
  const read = (relativePath) => fs.readFileSync(path.resolve(relativePath), "utf8");

  it("propagates usageMeta in the non-streaming write", () => {
    const source = read("open-sse/handlers/chatCore/nonStreamingHandler.js");
    const writes = source.match(/saveUsageStats\(\{[^;]+\}\);/gs) || [];
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("usageMeta: clientRawRequest?.usageMeta");
  });

  it("propagates usageMeta in both forced SSE-to-JSON writes", () => {
    const source = read("open-sse/handlers/chatCore/sseToJsonHandler.js");
    const writes = source.match(/saveUsageStats\(\{[^;]+\}\);/gs) || [];
    expect(writes).toHaveLength(2);
    expect(writes.every((write) => write.includes("usageMeta: clientRawRequest?.usageMeta"))).toBe(true);
  });

  it("propagates usageMeta in the translated and passthrough streaming completion write", () => {
    const source = read("open-sse/handlers/chatCore/streamingHandler.js");
    const writes = source.match(/saveUsageStats\(\{[^;]+\}\);/gs) || [];
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("usageMeta: clientRawRequest?.usageMeta");

    const streamSource = read("open-sse/utils/stream.js");
    expect(streamSource).toContain("if (onStreamComplete)");
    const logUsageSource = read("open-sse/utils/usageTracking.js").match(/export function logUsage[\s\S]*?\n\}/)?.[0] || "";
    expect(logUsageSource).not.toContain("saveRequestUsage");
  });
});
