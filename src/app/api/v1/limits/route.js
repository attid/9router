import { NextResponse } from "next/server";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";
import { getKeyUsageStats } from "@/sse/services/keyLimits.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key"
};

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * GET /v1/limits - Get usage and limits for the provided API key
 */
export async function GET(request) {
  const apiKey = extractApiKey(request);
  
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing API key in Authorization or x-api-key header" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const valid = await isValidApiKey(apiKey);
  if (!valid) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  try {
    const stats = await getKeyUsageStats(apiKey);
    return NextResponse.json(stats, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Limits API] Error fetching key usage:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage statistics" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
