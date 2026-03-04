import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";
import { normalizeUsagePreset } from "@/shared/utils/usagePeriod";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const preset = searchParams.get("preset");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (preset || start || end) {
      const data = await getChartData({
        preset: preset ? normalizeUsagePreset(preset) : null,
        start: start || null,
        end: end || null,
      });
      return NextResponse.json(data);
    }

    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const data = await getChartData(period);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
