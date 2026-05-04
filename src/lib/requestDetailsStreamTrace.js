function decodeBase64Utf8(value) {
  if (!value || typeof value !== "string") return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function parseSseBlocks(rawText) {
  return String(rawText || "")
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function parseSseBlock(block, index) {
  const lines = block.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
  const event = eventLine ? eventLine.slice(6).trim() : "message";
  const rawData = dataLines.join("\n");

  let payload = null;
  try {
    payload = rawData ? JSON.parse(rawData) : null;
  } catch {
    payload = rawData || null;
  }

  return {
    index,
    event,
    payload,
    summary: summarizeEvent(event, payload),
  };
}

function summarizeEvent(event, payload) {
  if (typeof payload === "string") {
    return payload.slice(0, 200);
  }

  if (!payload || typeof payload !== "object") {
    return event;
  }

  if (payload.error?.message) {
    return payload.error.message;
  }

  if (payload.delta?.text) {
    return payload.delta.text.slice(0, 200);
  }

  if (typeof payload.delta === "string") {
    return payload.delta.slice(0, 200);
  }

  if (payload.content_block?.type === "tool_use") {
    return `${payload.content_block.name || "tool"} tool call`;
  }

  if (payload.type) {
    return payload.type;
  }

  return event;
}

function extractTools(events) {
  return events
    .map((entry) => entry.payload)
    .filter((payload) => payload?.content_block?.type === "tool_use")
    .map((payload) => ({
      id: payload.content_block.id || null,
      name: payload.content_block.name || "unknown",
      input: payload.content_block.input || {},
    }));
}

function extractErrors(events) {
  return events
    .map((entry) => entry.payload)
    .filter((payload) => payload?.error?.message)
    .map((payload) => ({
      type: payload.error.type || "error",
      message: payload.error.message,
    }));
}

export function decodeRequestDetailStreamTrace(detail) {
  const providerRaw = decodeBase64Utf8(detail?.response?.meta?.raw_sse_b64);
  const clientTail = decodeBase64Utf8(detail?.response?.meta?.raw_sse_tail_b64);
  if (!providerRaw && !clientTail) {
    return {
      available: false,
      events: [],
      tools: [],
      errors: [],
      rawProviderSse: providerRaw,
      rawClientSse: clientTail,
    };
  }

  const providerEvents = parseSseBlocks(providerRaw);
  const clientEvents = parseSseBlocks(clientTail);
  const events = [...providerEvents, ...clientEvents].map((block, index) => parseSseBlock(block, index));

  return {
    available: true,
    events,
    tools: extractTools(events),
    errors: extractErrors(events),
    rawProviderSse: providerRaw,
    rawClientSse: clientTail,
  };
}
