import { createRequestDetailsExportStream } from "@/lib/requestDetailsDb";

export async function GET() {
  try {
    const body = await createRequestDetailsExportStream();
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="request-details-export.json"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error exporting request details:", error);
    return Response.json({ error: "Failed to export request details" }, { status: 500 });
  }
}
