import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, limits } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate limits if provided
    if (limits) {
      for (const period of ["hourly", "daily", "weekly"]) {
        if (limits[period] !== undefined && limits[period] !== null) {
          const val = Number(limits[period]);
          if (!Number.isInteger(val) || val < 0) {
            return NextResponse.json({ error: `Invalid ${period} limit: must be a non-negative integer` }, { status: 400 });
          }
        }
      }
    }

    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, limits || null);

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      limits: apiKey.limits || null,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
