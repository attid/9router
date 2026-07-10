export function maskApiKey(fullKey) {
  if (!fullKey || fullKey.length <= 10) return fullKey || "";
  return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
}

export function sortApiKeysByName(keys) {
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => {
      const result = String(a.key.name || "").localeCompare(
        String(b.key.name || ""),
        undefined,
        { sensitivity: "base" }
      );
      return result || a.index - b.index;
    })
    .map(({ key }) => key);
}

export function filterApiKeys(keys, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return keys;

  return keys.filter((key) =>
    [key.name, key.key, maskApiKey(key.key)]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery))
  );
}
