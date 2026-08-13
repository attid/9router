import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveRequestDetail: vi.fn(),
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => mocks);

import { saveComboLimitDetail } from "open-sse/handlers/chatCore/requestDetail.js";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue(undefined);
});

describe("combo limit detail events", () => {
  it("records safe routing and limit diagnostics without the raw key", async () => {
    await saveComboLimitDetail({
      action: "branch_skipped",
      usageMeta: {
        requestedModel: "BIG",
        comboPath: [
          { id: "combo-big", name: "BIG" },
          { id: "combo-kimi", name: "free_kimi" },
        ],
      },
      limitCheck: {
        comboId: "combo-kimi",
        comboName: "free_kimi",
        apiKeyId: "key-1",
        apiKeyName: "User A",
        period: "hourly",
        used: 1_050,
        limit: 1_000,
        retryAfter: 42,
        resetAt: "2026-11-01T06:00:00.000Z",
      },
    });

    expect(mocks.saveRequestDetail).toHaveBeenCalledOnce();
    expect(mocks.saveRequestDetail.mock.calls[0][0]).toMatchObject({
      eventType: "combo_limit",
      status: "branch_skipped",
      model: "free_kimi",
      routing: {
        rootModel: "BIG",
        comboPath: [
          { id: "combo-big", name: "BIG" },
          { id: "combo-kimi", name: "free_kimi" },
        ],
        blockedCombo: { id: "combo-kimi", name: "free_kimi" },
      },
      apiKeyIdentity: { id: "key-1", name: "User A" },
      limit: {
        period: "hourly",
        used: 1_050,
        limit: 1_000,
        retryAfter: 42,
        resetAt: "2026-11-01T06:00:00.000Z",
      },
    });
    expect(JSON.stringify(mocks.saveRequestDetail.mock.calls[0][0])).not.toContain("sk-secret");
  });
});
