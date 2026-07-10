import { beforeEach, describe, expect, it, vi } from "vitest";

const createRequestDetailsExportStream = vi.fn();

vi.mock("@/lib/requestDetailsDb", () => ({
  createRequestDetailsExportStream,
}));

describe("GET /api/settings/request-details-export", () => {
  let GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GET } = await import("../../src/app/api/settings/request-details-export/route.js"));
  });

  it("returns the request-details export stream without buffering it", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"format":"9router-request-details-export","requestDetails":[]}'));
        controller.close();
      },
    });
    createRequestDetailsExportStream.mockResolvedValue(body);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toContain("request-details-export.json");
    expect(response.headers.has("content-length")).toBe(false);
    expect(await response.json()).toMatchObject({
      format: "9router-request-details-export",
      requestDetails: [],
    });
    expect(createRequestDetailsExportStream).toHaveBeenCalledOnce();
  });

  it("returns 500 when export stream setup fails", async () => {
    createRequestDetailsExportStream.mockRejectedValueOnce(new Error("export failed"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to export request details" });
  });
});
