const API_KEY_NAME_COLLATOR = new Intl.Collator("en", { sensitivity: "base" });

function compareStrings(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function maskApiKey(fullKey) {
  if (!fullKey || fullKey.length <= 10) return fullKey || "";
  return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
}

export function sortApiKeysByName(keys) {
  return [...keys]
    .sort((a, b) =>
      API_KEY_NAME_COLLATOR.compare(String(a.name || ""), String(b.name || ""))
      || compareStrings(a.id, b.id)
    );
}

export function filterApiKeys(keys, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return keys;

  return keys.filter((key) =>
    [key.name, key.key, maskApiKey(key.key)]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery))
  );
}

export async function saveApiKeyName(
  id,
  name,
  { pendingIds, fetchImpl = fetch, onPendingChange = () => {} }
) {
  if (pendingIds.has(id)) return { status: "pending" };

  pendingIds.add(id);
  onPendingChange(id, true);
  try {
    const response = await fetchImpl(`/api/keys/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) return { status: "error" };

    const { key } = await response.json();
    return { status: "saved", key };
  } finally {
    pendingIds.delete(id);
    onPendingChange(id, false);
  }
}

export function keepDraftAfterKeyRename(draft, submittedId, submittedName) {
  if (draft?.id === submittedId && draft.value.trim() === submittedName) return null;
  return draft;
}

export function applyKeyRenameResponse(keys, id, updatedKey) {
  return keys.map((key) => key.id === id ? { ...key, name: updatedKey.name } : key);
}
