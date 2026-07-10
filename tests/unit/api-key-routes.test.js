import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({ body, status: init?.status || 200 })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: vi.fn(),
  createApiKey: mocks.createApiKey,
  deleteApiKey: vi.fn(),
  getApiKeyById: mocks.getApiKeyById,
  updateApiKey: mocks.updateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

const { POST } = await import("../../src/app/api/keys/route.js");
const { PUT } = await import("../../src/app/api/keys/[id]/route.js");

function jsonRequest(body) {
  return new Request("https://9router.local/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API key allowedModels routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue("machine-1");
    mocks.createApiKey.mockImplementation(async (name, machineId, allowedModels) => ({
      id: "key-1",
      key: "sk-created",
      name,
      machineId,
      allowedModels,
    }));
    mocks.getApiKeyById.mockResolvedValue({ id: "key-1", key: "sk-created", isActive: true });
    mocks.updateApiKey.mockImplementation(async (id, data) => ({ id, ...data }));
  });

  it("POST accepts and normalizes a model allowlist", async () => {
    const response = await POST(jsonRequest({
      name: "Production",
      allowedModels: [" openai/gpt-5 ", "production-combo", "openai/gpt-5"],
    }));

    expect(response.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith(
      "Production",
      "machine-1",
      ["openai/gpt-5", "production-combo"]
    );
    expect(response.body.allowedModels).toEqual(["openai/gpt-5", "production-combo"]);
  });

  it.each([
    ["string", "openai/gpt-5", "allowedModels must be an array or null"],
    ["blank entry", ["openai/gpt-5", "  "], "allowedModels must contain non-empty strings"],
    ["non-string entry", ["openai/gpt-5", 7], "allowedModels must contain non-empty strings"],
  ])("POST rejects %s", async (_label, allowedModels, error) => {
    const response = await POST(jsonRequest({ name: "Bad", allowedModels }));

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(error);
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });

  it.each([null, []])("POST treats %j as unrestricted", async (allowedModels) => {
    const response = await POST(jsonRequest({ name: "Unrestricted", allowedModels }));

    expect(response.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith("Unrestricted", "machine-1", null);
    expect(response.body.allowedModels).toBeNull();
  });

  it("PUT accepts allowlist changes while preserving existing update fields", async () => {
    const response = await PUT(
      jsonRequest({ isActive: false, allowedModels: [" anthropic/claude-sonnet-4-5 "] }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.updateApiKey).toHaveBeenCalledWith("key-1", {
      isActive: false,
      allowedModels: ["anthropic/claude-sonnet-4-5"],
    });
  });

  it.each([null, []])("PUT clears restrictions with %j", async (allowedModels) => {
    await PUT(jsonRequest({ allowedModels }), { params: Promise.resolve({ id: "key-1" }) });

    expect(mocks.updateApiKey).toHaveBeenCalledWith("key-1", { allowedModels: null });
  });

  it("PUT rejects invalid allowlists", async () => {
    const response = await PUT(
      jsonRequest({ allowedModels: ["openai/gpt-5", {}] }),
      { params: Promise.resolve({ id: "key-1" }) }
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("allowedModels must contain non-empty strings");
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });
});
