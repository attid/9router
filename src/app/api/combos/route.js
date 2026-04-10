import { NextResponse } from "next/server";
import { getCombos, createCombo, getComboByName } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// GET /api/combos - Get all combos
export async function GET() {
  try {
    const combos = await getCombos();
    return NextResponse.json({ combos });
  } catch (error) {
    console.log("Error fetching combos:", error);
    return NextResponse.json({ error: "Failed to fetch combos" }, { status: 500 });
  }
}

// POST /api/combos - Create new combo
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models, isFree } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate name format
    if (!VALID_NAME_REGEX.test(name)) {
      return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
    }

    // Check if name already exists
    const existing = await getComboByName(name);
    if (existing) {
      return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
    }

    // Validate models if provided
    if (models && Array.isArray(models)) {
      for (const entry of models) {
        if (typeof entry === "object" && entry !== null) {
          if (!entry.model || typeof entry.model !== "string") {
            return NextResponse.json({ error: "Each model object must have a 'model' string field" }, { status: 400 });
          }
          if (entry.weight !== undefined && (!Number.isInteger(entry.weight) || entry.weight < 0)) {
            return NextResponse.json({ error: "Model weight must be a non-negative integer" }, { status: 400 });
          }
        } else if (typeof entry !== "string") {
          return NextResponse.json({ error: "Models must be strings or {model, weight} objects" }, { status: 400 });
        }
      }
    }

    const combo = await createCombo({ name, models: models || [], isFree: Boolean(isFree) });

    return NextResponse.json(combo, { status: 201 });
  } catch (error) {
    console.log("Error creating combo:", error);
    return NextResponse.json({ error: "Failed to create combo" }, { status: 500 });
  }
}
