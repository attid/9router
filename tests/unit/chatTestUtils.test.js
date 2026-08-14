import { describe, it, expect, vi } from "vitest";
import {
  buildRequestPayload,
  extractAssistantText,
  fileToDataUrl,
  maskApiKey,
  scheduleRequestAbort,
} from "../../src/app/(dashboard)/dashboard/chat-test/chatTestUtils.js";

describe("chatTestUtils.buildRequestPayload", () => {
  it("builds a text-only chat payload", () => {
    expect(buildRequestPayload({ apiMode: "chat", model: "openai/gpt-5", prompt: " hello ", imageDataUrl: null })).toEqual({
      model: "openai/gpt-5",
      stream: false,
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
  });

  it("adds an image to a chat payload", () => {
    const payload = buildRequestPayload({ apiMode: "chat", model: "openai/gpt-5", prompt: "describe", imageDataUrl: "data:image/png;base64,AAA" });
    expect(payload.messages[0].content).toEqual([
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ]);
  });

  it("builds a responses payload with an image", () => {
    expect(buildRequestPayload({ apiMode: "responses", model: "openai/gpt-5", prompt: "describe", imageDataUrl: "data:image/jpeg;base64,BBB" })).toEqual({
      model: "openai/gpt-5",
      stream: false,
      input: [{ role: "user", content: [
        { type: "input_text", text: "describe" },
        { type: "input_image", image_url: "data:image/jpeg;base64,BBB" },
      ] }],
    });
  });
});

describe("chatTestUtils.extractAssistantText", () => {
  it("extracts a chat completion string", () => {
    expect(extractAssistantText("chat", { choices: [{ message: { content: "Hi" } }] })).toBe("Hi");
  });

  it("joins chat completion text parts", () => {
    expect(extractAssistantText("chat", { choices: [{ message: { content: [
      { type: "text", text: "Hello" },
      { type: "image_url", image_url: { url: "x" } },
      { type: "text", text: " world" },
    ] } }] })).toBe("Hello world");
  });

  it("uses top-level responses output_text", () => {
    expect(extractAssistantText("responses", { output_text: "Response text" })).toBe("Response text");
  });

  it("joins responses output blocks", () => {
    expect(extractAssistantText("responses", { output: [{ content: [
      { type: "output_text", text: "Part A" },
      { type: "output_text", text: " + Part B" },
    ] }] })).toBe("Part A + Part B");
  });

  it("returns an empty string when no text is present", () => {
    expect(extractAssistantText("responses", { output: [] })).toBe("");
  });
});

describe("chatTestUtils.fileToDataUrl", () => {
  it("rejects a non-image file", async () => {
    const file = new File(["abc"], "a.txt", { type: "text/plain" });
    await expect(fileToDataUrl(file)).rejects.toThrow(/Only image files/);
  });

  it("rejects an image above the configured limit", async () => {
    const file = new File([new Uint8Array(6)], "large.png", { type: "image/png" });
    await expect(fileToDataUrl(file, 5)).rejects.toThrow(/Image is too large/);
  });
});

describe("chatTestUtils.maskApiKey", () => {
  it("masks long, short, and empty keys", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-...cdef");
    expect(maskApiKey("abcd")).toBe("ab...cd");
    expect(maskApiKey("")).toBe("(empty)");
  });
});

describe("chatTestUtils.scheduleRequestAbort", () => {
  it("does not abort by default", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const cleanup = scheduleRequestAbort(controller);

    vi.advanceTimersByTime(120_000);

    expect(controller.signal.aborted).toBe(false);
    cleanup();
    vi.useRealTimers();
  });

  it("aborts only when a positive timeout is supplied", () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const cleanup = scheduleRequestAbort(controller, 50);

    vi.advanceTimersByTime(49);
    expect(controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(controller.signal.aborted).toBe(true);

    cleanup();
    vi.useRealTimers();
  });
});
