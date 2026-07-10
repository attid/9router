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

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }

    const updateData = {};
    if (Object.hasOwn(body, "isActive")) {
      if (typeof body.isActive !== "boolean") {
        return NextResponse.json({ error: "isActive must be a boolean" }, { status: 400 });
      }
      updateData.isActive = body.isActive;
    }
    if (Object.hasOwn(body, "name")) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }
      updateData.name = body.name.trim();
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
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
