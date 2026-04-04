import { describe, expect, it } from "vitest";
import {
  formatAccessTokenExpiry,
  formatSessionExpiry,
  getRefreshTokenStatus,
} from "../../src/app/(dashboard)/dashboard/providers/[id]/tokenInfo.js";

describe("provider token info formatting", () => {
  it("formats future access token expiry as relative time", () => {
    const now = new Date("2026-04-04T10:00:00.000Z").getTime();

    expect(formatAccessTokenExpiry("2026-04-04T10:45:00.000Z", now)).toBe("expires in 45m");
  });

  it("formats past access token expiry as expired relative time", () => {
    const now = new Date("2026-04-04T10:00:00.000Z").getTime();

    expect(formatAccessTokenExpiry("2026-04-04T08:00:00.000Z", now)).toBe("expired 2h ago");
  });

  it("returns unknown when access token expiry is unavailable", () => {
    expect(formatAccessTokenExpiry(null)).toBe("unknown");
  });

  it("formats session expiry from JWT exp claim", () => {
    const exp = Math.floor(new Date("2026-04-15T12:00:00.000Z").getTime() / 1000);

    expect(formatSessionExpiry({ exp })).toBe("Apr 15, 2026");
  });

  it("returns null when no session exp claim exists", () => {
    expect(formatSessionExpiry(null)).toBeNull();
    expect(formatSessionExpiry({})).toBeNull();
  });

  it("reports refresh token availability", () => {
    expect(getRefreshTokenStatus({ hasRefreshToken: true })).toEqual({
      tone: "success",
      label: "refresh token available",
    });
    expect(getRefreshTokenStatus({ hasRefreshToken: false })).toEqual({
      tone: "error",
      label: "refresh token missing",
    });
  });
});
