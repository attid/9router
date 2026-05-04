import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}));

describe("Kimi OAuth provider", () => {
  const originalFetch = global.fetch;
  let requestDeviceCode;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("requests device auth with kimi scope and kimi-cli headers", async () => {
    ({ requestDeviceCode } = await import("../../src/lib/oauth/providers.js"));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        device_code: "dev-code",
        user_code: "user-code",
        verification_uri: "https://www.kimi.com/code/authorize_device",
        expires_in: 900,
        interval: 5,
      }),
    });

    await requestDeviceCode("kimi-coding");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://auth.kimi.com/api/oauth/device_authorization");
    expect(init.method).toBe("POST");
    expect(init.headers["User-Agent"]).toBe("KimiCLI/1.37.0");
    expect(init.headers["X-Msh-Platform"]).toBe("kimi_cli");
    expect(init.body.get("client_id")).toBe("17e5f671-d194-4dfb-9706-5516cb48c098");
    expect(init.body.get("scope")).toBe("kimi-code");
  });
});
