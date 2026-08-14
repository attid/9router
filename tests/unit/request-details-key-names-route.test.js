import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  createApiKey: vi.fn(),
  getApiKeys: vi.fn(async () => [
    { id: "key-id-1", name: "Codex", key: "sk-secret-value", machineId: "machine-1", isActive: true },
  ]),
}));

vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn() }));

import { GET } from "../../src/app/api/keys/route.js";

describe("GET /api/keys?namesOnly=1", () => {
  it("returns only stable IDs and names for request-details display", async () => {
    const response = await GET(new Request("http://localhost/api/keys?namesOnly=1"));
    const body = await response.json();

    expect(body.keys).toEqual([{ id: "key-id-1", name: "Codex" }]);
    expect(JSON.stringify(body)).not.toContain("sk-secret-value");
  });
});
