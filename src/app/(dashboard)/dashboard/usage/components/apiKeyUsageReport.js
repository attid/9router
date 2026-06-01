export function buildApiKeyUsageRows(stats, filters = {}) {
  const query = (filters.query || "").trim().toLowerCase();
  const entries = Object.values(stats?.byApiKey || {});

  return entries
    .map((entry) => {
      const promptTokens = entry.promptTokens || 0;
      const completionTokens = entry.completionTokens || 0;
      const totalTokens = promptTokens + completionTokens;
      const keyName = entry.keyName || (entry.apiKey ? `${entry.apiKey.slice(0, 8)}...` : "Local (No API Key)");

      return {
        id: `${entry.apiKeyKey || entry.apiKey || "local-no-key"}|${entry.rawModel || ""}|${entry.provider || ""}`,
        apiKey: entry.apiKey || null,
        apiKeyKey: entry.apiKeyKey || entry.apiKey || "local-no-key",
        keyName,
        model: entry.rawModel || "unknown",
        provider: entry.provider || "unknown",
        requests: entry.requests || 0,
        promptTokens,
        completionTokens,
        totalTokens,
        cost: entry.cost || 0,
        lastUsed: entry.lastUsed || null,
      };
    })
    .filter((row) => {
      if (!query) return true;
      return [
        row.keyName,
        row.apiKey,
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
