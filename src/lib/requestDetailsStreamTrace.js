function decodeBase64Utf8(value) {
  if (!value || typeof value !== "string") return "";
  const compact = value.replace(/\s/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return "";
  try {
    const buffer = Buffer.from(compact, "base64");
    if (buffer.toString("base64") !== compact) return "";
    return buffer.toString("utf8");
  } catch {
    return "";
  }
}

function summarizeEvent(event, payload) {
  if (typeof payload === "string") return payload.slice(0, 200);
  if (!payload || typeof payload !== "object") return event;
  if (payload.error?.message) return payload.error.message;
  if (payload.delta?.text) return String(payload.delta.text).slice(0, 200);
  if (typeof payload.delta === "string") return payload.delta.slice(0, 200);
  if (payload.content_block?.type === "tool_use") return `${payload.content_block.name || "tool"} tool call`;
  return payload.type || event;
}

function parseSse(raw, source) {
  return String(raw || "")
    .split(/\r?\n\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/);
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      let payload = data || null;
      try { payload = data ? JSON.parse(data) : null; } catch { /* keep text payload */ }
      const event = eventLine?.slice(6).trim() || "message";
      return { source, event, payload, summary: summarizeEvent(event, payload) };
    });
}

function extractTools(events) {
  const parseInput = (value) => {
    if (!value) return {};
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return value; }
  };

  return events.flatMap(({ payload }) => {
    if (payload?.content_block?.type === "tool_use") {
      return [{
        id: payload.content_block.id || null,
        name: payload.content_block.name || "unknown",
        input: payload.content_block.input || {},
      }];
    }

    const responseItem = payload?.item;
    if (responseItem?.type === "function_call") {
      return [{
        id: responseItem.call_id || responseItem.id || null,
        name: responseItem.name || "unknown",
        input: parseInput(responseItem.arguments),
      }];
    }

    return (payload?.choices || []).flatMap((choice) =>
      (choice?.delta?.tool_calls || []).map((tool) => ({
        id: tool.id || null,
        name: tool.function?.name || "unknown",
        input: parseInput(tool.function?.arguments),
      }))
    );
  });
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
  const stored = detail?.streamTrace || {};
  const legacy = detail?.response?.meta || {};
  const rawProviderSse = decodeBase64Utf8(stored.providerSseBase64 || legacy.raw_sse_b64);
  const rawClientSse = decodeBase64Utf8(stored.clientSseBase64 || legacy.raw_sse_tail_b64);
  const events = [
    ...parseSse(rawProviderSse, "provider"),
    ...parseSse(rawClientSse, "client"),
  ].map((event, index) => ({ index, ...event }));

  return {
    available: Boolean(rawProviderSse || rawClientSse),
    truncated: Boolean(stored.truncated ?? legacy.raw_sse_truncated),
    maxBytesPerSide: stored.maxBytesPerSide ?? legacy.raw_sse_max_bytes ?? null,
    events,
    tools: extractTools(events),
    errors: extractErrors(events),
    rawProviderSse,
    rawClientSse,
  };
}
