export function buildApiKeyUsageRows(stats, filters = {}) {
  const query = (filters.query || "").trim().toLowerCase();
  const entries = Object.values(stats?.byApiKey || {});

  return entries
    .map((entry, index) => {
      const promptTokens = entry.promptTokens || 0;
      const completionTokens = entry.completionTokens || 0;
      const cachedTokens = entry.cachedTokens || 0;
      const apiKeyMasked = entry.apiKeyMasked || null;
      const keyName = entry.keyName || apiKeyMasked || "Local (No API Key)";
      const model = entry.rawModel || "unknown";
      const provider = entry.provider || "unknown";

      return {
        id: `${index}|${model}|${provider}`,
        apiKeyMasked,
        keyName,
        model,
        provider,
        requests: entry.requests || 0,
        promptTokens,
        completionTokens,
        cachedTokens,
        totalTokens: promptTokens + completionTokens,
        cost: entry.cost || 0,
        lastUsed: entry.lastUsed || null,
      };
    })
    .filter((row) => {
      if (!query) return true;
      return [
        row.keyName,
        row.apiKeyMasked,
        row.model,
        row.provider,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort((a, b) => {
      if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
      if (b.requests !== a.requests) return b.requests - a.requests;
      return String(a.keyName).localeCompare(String(b.keyName));
    });
}
