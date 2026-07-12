import { describe, expect, it } from "vitest";

import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";

describe("geminiToOpenAIRequest", () => {
  it("uses Gemini CLI parametersJsonSchema for tool declarations", () => {
    const result = geminiToOpenAIRequest("gpt-4o", {
      contents: [{ role: "user", parts: [{ text: "list files" }] }],
      tools: [{
        functionDeclarations: [{
          name: "list_directory",
          description: "Lists files in a directory",
          parametersJsonSchema: {
            type: "object",
            properties: { dir_path: { type: "string" } },
            required: ["dir_path"],
          },
        }],
      }],
    }, true);

    expect(result.tools[0].function.parameters).toEqual({
      type: "object",
      properties: { dir_path: { type: "string" } },
      required: ["dir_path"],
    });
  });

  it("preserves function call ids", () => {
    const result = geminiToOpenAIRequest("gpt-4o", {
      contents: [{
        role: "model",
        parts: [{
          functionCall: {
            id: "vsl4r2tk",
            name: "read_file",
            args: { file_path: "/tmp/index.html" },
          },
        }],
      }],
    }, true);

    expect(result.messages[0].tool_calls[0]).toEqual({
      id: "vsl4r2tk",
      type: "function",
      function: {
        name: "read_file",
        arguments: '{"file_path":"/tmp/index.html"}',
      },
    });
  });

  it("maps functionResponse.output to tool content", () => {
    const result = geminiToOpenAIRequest("gpt-4o", {
      contents: [{
        role: "user",
        parts: [{
          functionResponse: {
            id: "call_abc",
            name: "read_file",
            response: { output: "file contents here" },
          },
        }],
      }],
    }, true);

    expect(result.messages[0]).toEqual({
      role: "tool",
      tool_call_id: "call_abc",
      content: "file contents here",
    });
  });

  it("preserves parallel function responses from one Gemini user turn", () => {
    const result = geminiToOpenAIRequest("gpt-4o", {
      contents: [
        {
          role: "model",
          parts: [
            {
              functionCall: {
                id: "call_success",
                name: "read_file",
                args: { file_path: "GEMINI.md" },
              },
            },
            {
              functionCall: {
                id: "call_error",
                name: "read_file",
                args: { file_path: "missing.txt" },
              },
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                id: "call_success",
                name: "read_file",
                response: { output: "file contents" },
              },
            },
            {
              functionResponse: {
                id: "call_error",
                name: "read_file",
                response: { error: { type: "file_not_found" } },
              },
            },
          ],
        },
      ],
    }, true);

    expect(result.messages).toEqual([
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_success",
            type: "function",
            function: {
              name: "read_file",
              arguments: '{"file_path":"GEMINI.md"}',
            },
          },
          {
            id: "call_error",
            type: "function",
            function: {
              name: "read_file",
              arguments: '{"file_path":"missing.txt"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_success",
        content: "file contents",
      },
      {
        role: "tool",
        tool_call_id: "call_error",
        content: '{"error":{"type":"file_not_found"}}',
      },
    ]);
  });
});
