/** Collapse Gemini SSE chunks into one GenerateContentResponse. */
export function aggregateGeminiSSE(sseText) {
  let text = "";
  const parts = [];
  let finishReason = null;
  let usageMetadata = null;
  let modelVersion = null;
  let responseId = null;

  for (const line of sseText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }

    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    for (const part of candidate?.content?.parts || []) {
      if (part.functionCall) parts.push({ functionCall: part.functionCall });
      else if (typeof part.text === "string") text += part.text;
    }

    if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
    if (chunk.modelVersion) modelVersion = chunk.modelVersion;
    if (chunk.responseId) responseId = chunk.responseId;
  }

  const finalParts = [];
  if (text) finalParts.push({ text });
  finalParts.push(...parts);
  if (finalParts.length === 0) finalParts.push({ text: "" });

  const response = {
    candidates: [{
      content: { role: "model", parts: finalParts },
      finishReason: finishReason || "STOP",
      index: 0,
    }],
  };
  if (usageMetadata) response.usageMetadata = usageMetadata;
  if (modelVersion) response.modelVersion = modelVersion;
  if (responseId) response.responseId = responseId;
  return response;
}
