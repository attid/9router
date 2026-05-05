import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/sessionManager.js", () => ({
  deriveSessionId: vi.fn(() => "sess-kimi"),
}));

describe("kimi request shape", () => {
  let applyKimiRequestFields;
  let getTargetFormat;
  let translateRequest;
  let FORMATS;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ applyKimiRequestFields } = await import("../../open-sse/utils/kimiRequest.js"));
    ({ getTargetFormat } = await import("../../open-sse/services/provider.js"));
    ({ translateRequest } = await import("../../open-sse/translator/index.js"));
    ({ FORMATS } = await import("../../open-sse/translator/formats.js"));
  });

  it("uses openai target format for kimi-coding and does not inject Claude system prompt", () => {
    expect(getTargetFormat("kimi-coding")).toBe(FORMATS.OPENAI);

    const body = {
      model: "kmc/kimi-for-coding",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      getTargetFormat("kimi-coding"),
      "kimi-for-coding",
      JSON.parse(JSON.stringify(body)),
      true,
      null,
      "kimi-coding",
    );

    expect(result.system).toBeUndefined();
    expect(result.messages).toEqual(body.messages);
  });

  it("maps auto/off/high into native kimi body fields", () => {
    expect(applyKimiRequestFields({ messages: [], reasoning_effort: "auto" }, "conn-1")).toEqual({
      messages: [],
      prompt_cache_key: "sess-kimi",
    });

    expect(applyKimiRequestFields({ messages: [], reasoning_effort: "off" }, "conn-1")).toEqual({
      messages: [],
      prompt_cache_key: "sess-kimi",
      thinking: { type: "disabled" },
    });

    expect(applyKimiRequestFields({ messages: [], reasoning_effort: "high" }, "conn-1")).toEqual({
      messages: [],
      prompt_cache_key: "sess-kimi",
      reasoning_effort: "high",
      thinking: { type: "enabled" },
    });
  });
});
