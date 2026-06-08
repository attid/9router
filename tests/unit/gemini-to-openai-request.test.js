import { describe, it, expect } from "vitest";

import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";

describe("geminiToOpenAIRequest — Gemini CLI 0.45 wire format", () => {
  it("converts functionDeclarations using parametersJsonSchema", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "list files" }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: "list_directory",
              description: "Lists files in a directory",
              parametersJsonSchema: {
                type: "object",
                properties: { dir_path: { type: "string" } },
                required: ["dir_path"],
              },
            },
          ],
        },
      ],
    };

    const result = geminiToOpenAIRequest("gpt-4o", body, true);

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].function.name).toBe("list_directory");
    expect(result.tools[0].function.parameters).toEqual({
      type: "object",
      properties: { dir_path: { type: "string" } },
      required: ["dir_path"],
    });
  });

  it("preserves the Gemini functionCall id on the OpenAI tool_call", () => {
    const body = {
      contents: [
        {
          role: "model",
          parts: [
            {
              functionCall: {
                id: "vsl4r2tk",
                name: "read_file",
                args: { file_path: "/tmp/index.html" },
              },
            },
          ],
        },
      ],
    };

    const result = geminiToOpenAIRequest("gpt-4o", body, true);

    const asst = result.messages.find((m) => m.role === "assistant");
    expect(asst.tool_calls[0].id).toBe("vsl4r2tk");
    expect(asst.tool_calls[0].function.name).toBe("read_file");
    expect(JSON.parse(asst.tool_calls[0].function.arguments)).toEqual({
      file_path: "/tmp/index.html",
    });
  });

  it("maps functionResponse.response.output into the tool message content", () => {
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "call_abc",
                name: "read_file",
                response: { output: "file contents here" },
              },
            },
          ],
        },
      ],
    };

    const result = geminiToOpenAIRequest("gpt-4o", body, true);

    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe("call_abc");
    expect(toolMsg.content).toBe("file contents here");
  });
});
