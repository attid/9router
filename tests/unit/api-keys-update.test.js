import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteApiKey: vi.fn(),
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => mocks);

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const { PUT } = await import("../../src/app/api/keys/[id]/route.js");

const existingKey = {
  id: "key-1",
  name: "Before",
  key: "sk-history-link",
  machineId: "machine-1",
  isActive: true,
  createdAt: "2026-07-01T00:00:00.000Z",
};

function renameRequest(name) {
  return new Request("http://localhost/api/keys/key-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

describe("PUT /api/keys/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeyById.mockResolvedValue(existingKey);
    mocks.updateApiKey.mockImplementation(async (_id, update) => ({ ...existingKey, ...update }));
  });

  it("trims the new name without updating the key value", async () => {
    const response = await PUT(renameRequest("  Production  "), {
      params: Promise.resolve({ id: existingKey.id }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateApiKey).toHaveBeenCalledWith(existingKey.id, { name: "Production" });
    await expect(response.json()).resolves.toMatchObject({
      key: { name: "Production", key: existingKey.key },
    });
  });

  it.each(["   ", null, 42])("rejects an invalid name: %j", async (name) => {
    const response = await PUT(renameRequest(name), {
      params: Promise.resolve({ id: existingKey.id }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Name is required" });
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });

  it("returns 404 without attempting an update when the key does not exist", async () => {
    mocks.getApiKeyById.mockResolvedValue(null);

    const response = await PUT(renameRequest("Production"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });
});
