import { NextResponse } from "next/server";
import { getRequestDetailById } from "@/lib/usageDb";
import { decodeRequestDetailStreamTrace } from "@/lib/requestDetailsStreamTrace";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const detail = await getRequestDetailById(id);

    if (!detail) {
      return NextResponse.json({ error: "Request detail not found" }, { status: 404 });
    }

    return NextResponse.json(decodeRequestDetailStreamTrace(detail));
  } catch (error) {
    console.error("[API] Failed to decode request detail stream trace:", error);
    return NextResponse.json({ error: "Failed to decode stream trace" }, { status: 500 });
  }
}
