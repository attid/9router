import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApiKey: vi.fn(),
  getApiKeys: vi.fn(),
  getApiKeyById: vi.fn(),
  updateApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  getKeyUsageStats: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  createApiKey: mocks.createApiKey,
  getApiKeys: mocks.getApiKeys,
  getApiKeyById: mocks.getApiKeyById,
  updateApiKey: mocks.updateApiKey,
  deleteApiKey: mocks.deleteApiKey,
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/sse/services/keyLimits.js", () => ({ getKeyUsageStats: mocks.getKeyUsageStats }));

import { POST } from "@/app/api/keys/route.js";
import { PUT } from "@/app/api/keys/[id]/route.js";
import { GET as GET_USAGE } from "@/app/api/keys/[id]/usage/route.js";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getConsistentMachineId.mockResolvedValue("machine-route-test");
});

describe("API-key limits routes", () => {
  it("accepts calendar limits when creating a key", async () => {
    mocks.createApiKey.mockResolvedValue({
      id: "key-1",
      key: "sk-created",
      name: "Limited",
      machineId: "machine-route-test",
      limits: { hourly: 100, daily: 1_000, weekly: null },
    });
    const request = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Limited", limits: { hourly: 100, daily: 1_000 } }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith("Limited", "machine-route-test", {
      hourly: 100,
      daily: 1_000,
      weekly: null,
    });
    await expect(response.json()).resolves.toMatchObject({ limits: { hourly: 100, daily: 1_000, weekly: null } });
  });

  it("rejects negative, fractional, and nonnumeric limits", async () => {
    for (const invalid of [-1, 1.5, "many"]) {
      const response = await POST(new Request("http://localhost/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Invalid", limits: { hourly: invalid } }),
      }));
      expect(response.status).toBe(400);
    }
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });

  it("updates only supplied limits alongside active state", async () => {
    mocks.getApiKeyById.mockResolvedValue({ id: "key-1", limits: { hourly: 100, daily: 1_000 } });
    mocks.updateApiKey.mockResolvedValue({ id: "key-1", isActive: false, limits: { hourly: 200, daily: 1_000 } });
    const response = await PUT(new Request("http://localhost/api/keys/key-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: false, limits: { hourly: 200 } }),
    }), { params: Promise.resolve({ id: "key-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.updateApiKey).toHaveBeenCalledWith("key-1", {
      isActive: false,
      limits: { hourly: 200 },
    });
  });

  it("returns progress by key id without exposing its raw key", async () => {
    mocks.getApiKeyById.mockResolvedValue({ id: "key-1", key: "sk-secret", name: "Limited" });
    mocks.getKeyUsageStats.mockResolvedValue({
      hourly: { used: 50, limit: 100 },
      daily: { used: 500, limit: 1_000 },
      weekly: { used: 500, limit: null },
    });

    const response = await GET_USAGE(new Request("http://localhost/api/keys/key-1/usage"), {
      params: Promise.resolve({ id: "key-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getKeyUsageStats).toHaveBeenCalledWith("sk-secret");
    expect(payload).toEqual({ usage: {
      hourly: { used: 50, limit: 100 },
      daily: { used: 500, limit: 1_000 },
      weekly: { used: 500, limit: null },
    } });
    expect(JSON.stringify(payload)).not.toContain("sk-secret");
  });
});
