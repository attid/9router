import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats } from "./requestDetail.js";
import { createErrorResult } from "../../utils/error.js";
import { saveRequestDetail } from "@/lib/usageDb.js";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
  "Access-Control-Allow-Origin": "*"
};

function buildStructuredStreamingFallback(contentObj, usage) {
  const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
  const hasThinking = Boolean(contentObj?.thinking && String(contentObj.thinking).trim());
  const summary = {
    type: "no_text_stream_output",
    reason: "No assistant text fragments were detected in translated or provider stream events.",
    output_tokens: completionTokens,
    input_tokens: promptTokens,
    has_thinking: hasThinking
  };
  return `[No text output in stream]\n${JSON.stringify(summary, null, 2)}`;
}

function getFinalStreamingContent(contentObj, usage) {
  const text = typeof contentObj?.content === "string" ? contentObj.content.trim() : "";
  if (text) return contentObj.content;
  return buildStructuredStreamingFallback(contentObj, usage);
}

function parseSseEventBlocks(rawText) {
  return String(rawText || "")
    .split(/\n\n+/)
    .map(block => block.trim())
    .filter(Boolean);
}

function getSseEventType(block) {
  const eventLine = block.split("\n").find(line => line.startsWith("event:"));
  return eventLine ? eventLine.slice(6).trim() : "";
}

function getSseEventPayload(block) {
  const dataLines = block
    .split("\n")
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trim());
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
}

export function detectStreamingPreludeError(rawText) {
  let sawAssistantText = false;

  for (const block of parseSseEventBlocks(rawText)) {
    const payload = getSseEventPayload(block);
    if (!payload || typeof payload !== "object") continue;

    if (payload.delta?.text && typeof payload.delta.text === "string" && payload.delta.text.trim()) {
      sawAssistantText = true;
    }

    const eventType = getSseEventType(block) || payload.type;
    if (eventType === "error" && !sawAssistantText) {
      const message =
        payload.error?.message ||
        payload.message ||
        "Streaming provider error";
      return {
        statusCode: 529,
        message,
        errorType: payload.error?.type || "stream_error",
      };
    }
  }

  return null;
}

async function inspectStreamingPrelude(providerResponse, maxBytes = 16384) {
  if (!providerResponse?.body) {
    return { providerResponse, preludeError: null };
  }

  const reader = providerResponse.body.getReader();
  const decoder = new TextDecoder();
  const bufferedChunks = [];
  let bufferedBytes = 0;
  let bufferedText = "";
  let sawBoundary = false;

  while (bufferedBytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;

    bufferedChunks.push(value);
    bufferedBytes += value.byteLength;
    bufferedText += decoder.decode(value, { stream: true });

    if (bufferedText.includes("\n\n")) {
      sawBoundary = true;
    }

    const preludeError = detectStreamingPreludeError(bufferedText);
    if (preludeError) {
      await reader.cancel().catch(() => {});
      return { providerResponse: null, preludeError };
    }

    if (sawBoundary && bufferedText.includes('"delta":{"text":"')) {
      break;
    }
  }

  const tail = decoder.decode();
  if (tail) {
    bufferedText += tail;
  }

  const reconstructedBody = new ReadableStream({
    start(controller) {
      for (const chunk of bufferedChunks) {
        controller.enqueue(chunk);
      }
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  });

  return {
    preludeError: null,
    providerResponse: new Response(reconstructedBody, {
      status: providerResponse.status,
      statusText: providerResponse.statusText,
      headers: providerResponse.headers,
    }),
  };
}

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  const needsCodexTranslation = provider === "codex" && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    // Codex returns Responses API SSE → translate to client format
    let codexTarget;
    if (sourceFormat === FORMATS.OPENAI_RESPONSES) codexTarget = FORMATS.OPENAI_RESPONSES;
    else if (sourceFormat === FORMATS.CLAUDE) codexTarget = FORMATS.CLAUDE;
    else if (sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI) codexTarget = FORMATS.ANTIGRAVITY;
    else codexTarget = FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey);
  }

  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey);
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, streamController, onStreamComplete }) {
  const inspected = await inspectStreamingPrelude(providerResponse);
  if (inspected.preludeError) {
    streamController.handleError(new Error(inspected.preludeError.message));
    return createErrorResult(inspected.preludeError.statusCode, inspected.preludeError.message);
  }

  if (onRequestSuccess) onRequestSuccess();

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey });
  const transformedBody = pipeWithDisconnect(inspected.providerResponse, transformStream, streamController);

  return {
    success: true,
    response: new Response(transformedBody, { headers: SSE_HEADERS })
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, providerUrl }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId, apiKeyId: apiKey,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      status: "success"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE" });
  };

  return { onStreamComplete, streamDetailId };
}
