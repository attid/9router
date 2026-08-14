import fs from "node:fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js", import.meta.url),
  "utf8"
);

describe("request-details dashboard overlay contract", () => {
  it("maps stable API-key IDs to names without indexing by raw key value", () => {
    expect(source).toContain("apiKeyNameCache[k.id]");
    expect(source).toContain("detail.apiKeyId");
    expect(source).not.toContain("apiKeyNameCache[k.key]");
  });

  it("shows client/upstream endpoints and an expandable on-demand stream trace", () => {
    expect(source).toContain("Client Endpoint:");
    expect(source).toContain("Upstream URL:");
    expect(source).toContain("Stream Trace");
    expect(source).toContain("stream-trace");
    expect(source).toContain("Raw Provider SSE");
    expect(source).toContain("Raw Client SSE");
    expect(source).toContain('colSpan="9"');
    expect(source).not.toContain('colSpan="7"');
  });

  it("aborts and generation-guards trace fetches when the drawer selection changes", () => {
    expect(source).toContain("useRef");
    expect(source).toContain("new AbortController()");
    expect(source).toContain("signal: controller.signal");
    expect(source).toContain("streamTraceGenerationRef.current");
    expect(source).toContain("controller.abort()");
    expect(source).toContain('error.name !== "AbortError"');
  });

  it("keeps all request-details client fetches root-relative", () => {
    expect(source).toContain('fetch(`/api/usage/request-details/${encodeURIComponent');
    expect(source).not.toContain("basePath");
    expect(source).not.toMatch(/fetch\(`?api\//);
  });
});
