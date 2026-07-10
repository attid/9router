import { describe, expect, it } from "vitest";

const loadUtils = () => import("../../src/app/(dashboard)/dashboard/endpoint/endpointKeyUtils.js");

const keys = [
  { id: "1", name: "beta", key: "sk-beta-secret", createdAt: "2026-01-03" },
  { id: "2", name: "Alpha", key: "sk-alpha-secret", createdAt: "2026-01-02" },
  { id: "3", name: "alpha", key: "sk-another-secret", createdAt: "2026-01-01" },
];

describe("endpoint API-key helpers", () => {
  it("sorts by name case-insensitively while preserving equal-name input order", async () => {
    const { sortApiKeysByName } = await loadUtils();

    expect(sortApiKeysByName(keys).map((key) => key.id)).toEqual(["2", "3", "1"]);
    expect(keys.map((key) => key.id)).toEqual(["1", "2", "3"]);
  });

  it("filters case-insensitively by name and full key", async () => {
    const { filterApiKeys } = await loadUtils();

    expect(filterApiKeys(keys, "ALPH").map((key) => key.id)).toEqual(["2", "3"]);
    expect(filterApiKeys(keys, "BETA-SEC").map((key) => key.id)).toEqual(["1"]);
  });

  it("filters by the masked key displayed in the endpoint UI", async () => {
    const { filterApiKeys, maskApiKey } = await loadUtils();
    const masked = maskApiKey(keys[0].key);

    expect(masked).not.toBe(keys[0].key);
    expect(filterApiKeys(keys, masked).map((key) => key.id)).toEqual(["1"]);
  });

  it("trims the query and returns every key for an empty filter", async () => {
    const { filterApiKeys } = await loadUtils();

    expect(filterApiKeys(keys, "  secret  ").map((key) => key.id)).toEqual(["1", "2", "3"]);
    expect(filterApiKeys(keys, "   ")).toEqual(keys);
  });
});
