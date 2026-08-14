import { describe, expect, it, vi } from "vitest";

const loadUtils = () => import("../../src/app/(dashboard)/dashboard/endpoint/endpointKeyUtils.js");

const keys = [
  { id: "1", name: "beta", key: "sk-beta-secret", createdAt: "2026-01-03" },
  { id: "2", name: "Alpha", key: "sk-alpha-secret", createdAt: "2026-01-02" },
  { id: "3", name: "alpha", key: "sk-another-secret", createdAt: "2026-01-01" },
];

describe("endpoint API-key helpers", () => {
  it("sorts by name case-insensitively without mutating the input", async () => {
    const { sortApiKeysByName } = await loadUtils();

    expect(sortApiKeysByName(keys).map((key) => key.id)).toEqual(["2", "3", "1"]);
    expect(keys.map((key) => key.id)).toEqual(["1", "2", "3"]);
  });

  it("uses key id as a deterministic tie-breaker for equivalent names", async () => {
    const { sortApiKeysByName } = await loadUtils();
    const equivalentNames = [
      { id: "key-20", name: "ALPHA" },
      { id: "key-3", name: "alpha" },
      { id: "key-1", name: "Alpha" },
    ];

    expect(sortApiKeysByName(equivalentNames).map((key) => key.id)).toEqual([
      "key-1",
      "key-20",
      "key-3",
    ]);
    expect(sortApiKeysByName([...equivalentNames].reverse()).map((key) => key.id)).toEqual([
      "key-1",
      "key-20",
      "key-3",
    ]);
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

  it("blocks overlapping saves for the same key while allowing another key", async () => {
    const { saveApiKeyName } = await loadUtils();
    const pendingIds = new Set();
    let resolveFirst;
    const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
    const fetchImpl = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: { id: "2", name: "Second" } })));

    const firstSave = saveApiKeyName("1", "First", { pendingIds, fetchImpl });
    const overlappingSave = await saveApiKeyName("1", "Stale", { pendingIds, fetchImpl });
    const otherSave = await saveApiKeyName("2", "Second", { pendingIds, fetchImpl });

    expect(overlappingSave).toEqual({ status: "pending" });
    expect(otherSave).toEqual({ status: "saved", key: { id: "2", name: "Second" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    resolveFirst(new Response(JSON.stringify({ key: { id: "1", name: "Canonical First" } })));
    await expect(firstSave).resolves.toEqual({
      status: "saved",
      key: { id: "1", name: "Canonical First" },
    });
    expect(pendingIds.size).toBe(0);
  });

  it("only clears the draft that produced a completed save", async () => {
    const { keepDraftAfterKeyRename } = await loadUtils();
    const submittedDraft = { id: "1", value: "First" };
    const newerDraft = { id: "2", value: "Second" };

    expect(keepDraftAfterKeyRename(submittedDraft, "1", "First")).toBeNull();
    expect(keepDraftAfterKeyRename(newerDraft, "1", "First")).toBe(newerDraft);
    expect(keepDraftAfterKeyRename({ id: "1", value: "New value" }, "1", "First"))
      .toEqual({ id: "1", value: "New value" });
  });

  it("applies the name returned by the server", async () => {
    const { applyKeyRenameResponse } = await loadUtils();

    expect(applyKeyRenameResponse(keys, "1", { name: "Canonical Beta" }))
      .toEqual([
        { ...keys[0], name: "Canonical Beta" },
        keys[1],
        keys[2],
      ]);
  });
});
