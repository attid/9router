import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive, limits, allowedModels } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;

    if (limits !== undefined) {
      // Validate limits
      if (limits !== null) {
        for (const period of ["hourly", "daily", "weekly"]) {
          if (limits[period] !== undefined && limits[period] !== null) {
            const val = Number(limits[period]);
            if (!Number.isInteger(val) || val < 0) {
              return NextResponse.json({ error: `Invalid ${period} limit: must be a non-negative integer` }, { status: 400 });
            }
          }
        }
      }
      updateData.limits = limits;
    }

    if (allowedModels !== undefined) {
      if (allowedModels !== null && !Array.isArray(allowedModels)) {
        return NextResponse.json({ error: "allowedModels must be an array or null" }, { status: 400 });
      }
      if (Array.isArray(allowedModels) && allowedModels.some(m => typeof m !== "string" || !m.trim())) {
        return NextResponse.json({ error: "allowedModels must contain non-empty strings" }, { status: 400 });
      }
      updateData.allowedModels = allowedModels;
    }

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
