import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.fn();
const delaySpy = vi.spyOn(global, "setTimeout").mockImplementation((fn) => {
  fn();
  return 0;
});

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Kimi refresh", () => {
  let DefaultExecutor;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ DefaultExecutor } = await import("../../open-sse/executors/default.js"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delaySpy.mockRestore();
  });

  it("retries transient kimi refresh failures with kimi headers", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "server error" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "next-access",
          refresh_token: "next-refresh",
          expires_in: 3600,
        }),
      });

    const executor = new DefaultExecutor("kimi-coding");
    const result = await executor.refreshKimiCoding("refresh-token");

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    const [, init] = proxyAwareFetch.mock.calls[0];
    expect(init.headers["User-Agent"]).toBe("KimiCLI/1.37.0");
    expect(init.headers["X-Msh-Platform"]).toBe("kimi_cli");
    expect(result).toEqual({
      accessToken: "next-access",
      refreshToken: "next-refresh",
      expiresIn: 3600,
    });
  });
});
