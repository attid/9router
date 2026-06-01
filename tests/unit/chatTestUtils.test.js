import { describe, it, expect, vi } from "vitest";
import {
  buildRequestPayload,
  extractAssistantText,
  fileToDataUrl,
  maskApiKey,
  scheduleRequestAbort,
} from "../../src/app/(dashboard)/dashboard/chat-test/chatTestUtils.js";

describe("chatTestUtils.buildRequestPayload", () => {
  it("builds chat payload with text only", () => {
    const payload = buildRequestPayload({
      apiMode: "chat",
      model: "if/kimi-k2-thinking",
      prompt: "hello",
      imageDataUrl: null,
    });

    expect(payload).toEqual({
      model: "if/kimi-k2-thinking",
      stream: false,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      ],
    });
  });

  it("builds chat payload with image", () => {
    const payload = buildRequestPayload({
      apiMode: "chat",
      model: "if/kimi-k2-thinking",
      prompt: "describe",
      imageDataUrl: "data:image/png;base64,AAA",
    });

    expect(payload.messages[0].content).toEqual([
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ]);
  });

  it("builds responses payload with image", () => {
    const payload = buildRequestPayload({
      apiMode: "responses",
      model: "if/kimi-k2-thinking",
      prompt: "describe",
      imageDataUrl: "data:image/jpeg;base64,BBB",
    });

    expect(payload).toEqual({
      model: "if/kimi-k2-thinking",
      stream: false,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "describe" },
            { type: "input_image", image_url: "data:image/jpeg;base64,BBB" },
          ],
        },
      ],
    });
  });
});

describe("chatTestUtils.extractAssistantText", () => {
  it("extracts text from chat completion response", () => {
    const text = extractAssistantText("chat", {
      choices: [{ message: { content: "Hi there" } }],
    });

    expect(text).toBe("Hi there");
  });

  it("extracts text from chat completion content array", () => {
    const text = extractAssistantText("chat", {
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "Hello" },
              { type: "image_url", image_url: { url: "x" } },
              { type: "text", text: " world" },
            ],
          },
        },
      ],
    });

    expect(text).toBe("Hello world");
  });

  it("extracts output_text from responses API", () => {
    const text = extractAssistantText("responses", {
      output_text: "Response text",
    });

    expect(text).toBe("Response text");
  });

  it("extracts output text from responses output blocks", () => {
    const text = extractAssistantText("responses", {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "Part A" },
            { type: "output_text", text: " + Part B" },
          ],
        },
      ],
    });

    expect(text).toBe("Part A + Part B");
  });

  it("returns empty string when no text found", () => {
    const text = extractAssistantText("responses", { output: [] });
    expect(text).toBe("");
  });
});

describe("chatTestUtils.fileToDataUrl", () => {
  it("throws when file is not an image", async () => {
    const badFile = new File(["abc"], "a.txt", { type: "text/plain" });

    await expect(fileToDataUrl(badFile, 5 * 1024 * 1024)).rejects.toThrow(/Only image files are supported/i);
  });

  it("throws when file exceeds size limit", async () => {
    const tooBig = new File([new Uint8Array(6 * 1024 * 1024)], "big.png", { type: "image/png" });

    await expect(fileToDataUrl(tooBig, 5 * 1024 * 1024)).rejects.toThrow(/Image is too large/i);
  });
});

describe("chatTestUtils.maskApiKey", () => {
  it("masks long key keeping first 3 and last 4 chars", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-...cdef");
  });

  it("returns fallback for empty value", () => {
    expect(maskApiKey("")).toBe("(empty)");
    expect(maskApiKey(null)).toBe("(empty)");
  });

  it("masks short keys without breaking", () => {
    expect(maskApiKey("abcd")).toBe("ab...cd");
  });
});

describe("chatTestUtils.scheduleRequestAbort", () => {
  it("does not abort when timeout is disabled", () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    const cleanup = scheduleRequestAbort(controller, 0);
    vi.advanceTimersByTime(120000);

    expect(controller.signal.aborted).toBe(false);
    cleanup();
    vi.useRealTimers();
  });

  it("aborts when a positive timeout is provided", () => {
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
