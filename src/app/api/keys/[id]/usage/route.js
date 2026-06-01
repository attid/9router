import { NextResponse } from "next/server";
import { getApiKeyById } from "@/lib/localDb";
import { getKeyUsageStats } from "@/sse/services/keyLimits";

// GET /api/keys/[id]/usage — current consumption for a key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const keyConfig = await getApiKeyById(id);
    if (!keyConfig) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const stats = await getKeyUsageStats(keyConfig.key);
    return NextResponse.json(stats);
  } catch (error) {
    console.log("Error fetching key usage:", error);
    return NextResponse.json({ error: "Failed to fetch usage" }, { status: 500 });
  }
}
