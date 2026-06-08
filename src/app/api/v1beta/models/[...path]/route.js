import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { aggregateGeminiSSE } from "open-sse/translator/helpers/geminiStreamAggregate.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * Parse the `{model}:{action}` tail of the v1beta path.
 *   ["model:action"]            -> { model: "model", action }
 *   ["provider", "model:action"] -> { model: "provider/model", action }
 */
function parseModelAction(path) {
  const tail = path.length >= 2 ? path[1] : path[0];
  const action = tail.includes(":streamGenerateContent")
    ? ":streamGenerateContent"
    : ":generateContent";
  const modelName = tail.replace(":streamGenerateContent", "").replace(":generateContent", "");
  const model = path.length >= 2 ? `${path[0]}/${modelName}` : modelName;
  return { model, action };
}

/**
 * POST /v1beta/models/{model}:generateContent        — non-streaming
 * POST /v1beta/models/{model}:streamGenerateContent  — streaming (SSE)
 *
 * The raw Gemini body is forwarded to the shared chat engine, which detects the
 * Gemini format (contents[]) and runs the full Gemini↔OpenAI translator —
 * including tools / functionCall / functionResponse. The engine emits Gemini
 * SSE directly for Gemini-source requests.
 *
 * Streaming intent is determined by the URL action suffix (canonical Gemini API
 * convention), NOT by a body field. For :generateContent we collapse the engine's
 * Gemini SSE into a single GenerateContentResponse.
 */
export async function POST(request, { params }) {
  await ensureInitialized();

  try {
    const { path } = await params;
    const { model, action } = parseModelAction(path);
    const stream = action === ":streamGenerateContent";

    const body = await request.json();
    body.model = model; // model comes from the URL, not the Gemini body

    const newRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(body),
    });

    const response = await handleChat(newRequest);

    if (stream) {
      // Engine already produced Gemini SSE for the Gemini-source request.
      return response;
    }

    // Non-streaming: collapse the Gemini SSE into a single GenerateContentResponse.
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/event-stream")) {
      // Error or already-JSON response — pass through unchanged.
      return response;
    }

    const sseText = await response.text();
    const aggregated = aggregateGeminiSSE(sseText);
    if (model && !aggregated.modelVersion) aggregated.modelVersion = model;

    return Response.json(aggregated, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.log("Error handling Gemini request:", error);
    return Response.json(
      { error: { message: error.message, code: 500 } },
      { status: 500 }
    );
  }
}
