import { describe, it, expect } from "vitest";
import {
  openaiResponsesToOpenAIRequest,
  openaiToOpenAIResponsesRequest,
} from "../../open-sse/translator/request/openai-responses.js";

describe("openai-responses request translator image compatibility", () => {
  it("converts input_image to image_url for OpenAI chat format", () => {
    const result = openaiResponsesToOpenAIRequest("openrouter/any", {
      model: "openrouter/any",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "describe image" },
            { type: "input_image", image_url: "data:image/png;base64,AAA" },
          ],
        },
      ],
    });

    expect(result.messages?.[0]?.content).toEqual([
      { type: "text", text: "describe image" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ]);
  });

  it("converts image_url to input_image for Responses format", () => {
    const result = openaiToOpenAIResponsesRequest("codex/gpt-5.2", {
      model: "codex/gpt-5.2",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is in image?" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBB" } },
          ],
        },
      ],
    });

    expect(result.input?.[0]?.content).toEqual([
      { type: "input_text", text: "what is in image?" },
      { type: "input_image", image_url: "data:image/jpeg;base64,BBB" },
    ]);
  });
});

