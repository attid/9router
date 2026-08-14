import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { adjustMaxTokens } from "../formats/maxTokens.js";
import { encodeDataUri } from "../concerns/image.js";
import { collapseTextParts } from "../concerns/message.js";
import { ROLE, GEMINI_ROLE, OPENAI_BLOCK } from "../schema/index.js";

// Convert Gemini request to OpenAI format
export function geminiToOpenAIRequest(model, body, stream) {
  const result = {
    model: model,
    messages: [],
    stream: stream
  };

  // Generation config
  if (body.generationConfig) {
    const config = body.generationConfig;
    if (config.maxOutputTokens) {
      const tempBody = { max_tokens: config.maxOutputTokens, tools: body.tools };
      result.max_tokens = adjustMaxTokens(tempBody);
    }
    if (config.temperature !== undefined) {
      result.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      result.top_p = config.topP;
    }
  }

  // System instruction
  if (body.systemInstruction) {
    const systemText = extractGeminiText(body.systemInstruction);
    if (systemText) {
      result.messages.push({
        role: ROLE.SYSTEM,
        content: systemText
      });
    }
  }

  // Convert contents to messages
  if (body.contents && Array.isArray(body.contents)) {
    const toolCallState = { byName: new Map(), sequence: 0 };
    for (const content of body.contents) {
      const converted = convertGeminiContent(content, toolCallState);
      if (Array.isArray(converted)) {
        result.messages.push(...converted);
      } else if (converted) {
        result.messages.push(converted);
      }
    }
  }

  // Tools
  if (body.tools && Array.isArray(body.tools)) {
    result.tools = [];
    for (const tool of body.tools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          result.tools.push({
            type: OPENAI_BLOCK.FUNCTION,
            function: {
              name: func.name,
              description: func.description || "",
              parameters: func.parametersJsonSchema || func.parameters || { type: "object", properties: {} }
            }
          });
        }
      }
    }
  }

  return result;
}

// Convert Gemini content to OpenAI message
function convertGeminiContent(content, toolCallState) {
  const role = content.role === GEMINI_ROLE.USER ? ROLE.USER : ROLE.ASSISTANT;
  
  if (!content.parts || !Array.isArray(content.parts)) {
    return null;
  }

  const parts = [];
  const toolCalls = [];
  const toolResponses = [];

  for (const part of content.parts) {
    if (part.text !== undefined) {
      parts.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
    }

    if (part.inlineData) {
      parts.push({
        type: OPENAI_BLOCK.IMAGE_URL,
        image_url: {
          url: encodeDataUri(part.inlineData.mimeType, part.inlineData.data)
        }
      });
    }

    if (part.functionCall) {
      const callId = part.functionCall.id || `call_${part.functionCall.name}_${toolCallState.sequence++}`;
      const pendingIds = toolCallState.byName.get(part.functionCall.name) || [];
      pendingIds.push(callId);
      toolCallState.byName.set(part.functionCall.name, pendingIds);
      toolCalls.push({
        id: callId,
        type: OPENAI_BLOCK.FUNCTION,
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {})
        }
      });
    }

    if (part.functionResponse) {
      const response = part.functionResponse.response;
      const responseContent = response?.output ?? response?.result ?? response ?? {};
      const pendingIds = toolCallState.byName.get(part.functionResponse.name) || [];
      let callId = part.functionResponse.id;
      if (callId) {
        const matchingIndex = pendingIds.indexOf(callId);
        if (matchingIndex !== -1) pendingIds.splice(matchingIndex, 1);
      } else {
        callId = pendingIds.shift() || `call_${part.functionResponse.name}`;
      }
      toolResponses.push({
        role: ROLE.TOOL,
        tool_call_id: callId,
        content: typeof responseContent === "string" ? responseContent : JSON.stringify(responseContent)
      });
    }
  }

  const messages = [];

  if (toolCalls.length > 0) {
    const result = { role: ROLE.ASSISTANT };
    if (parts.length > 0) {
      result.content = parts.length === 1 ? parts[0].text : parts;
    }
    result.tool_calls = toolCalls;
    messages.push(result);
  }

  messages.push(...toolResponses);

  if (parts.length > 0 && toolCalls.length === 0) {
    messages.push({
      role,
      content: collapseTextParts(parts)
    });
  }

  if (messages.length === 0) return null;
  return messages.length === 1 ? messages[0] : messages;
}

// Extract text from Gemini content
function extractGeminiText(content) {
  if (typeof content === "string") return content;
  if (content.parts && Array.isArray(content.parts)) {
    return content.parts.map(p => p.text || "").join("");
  }
  return "";
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, geminiToOpenAIRequest, null);
