"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import { apiPath } from "@/lib/basePath";
import { buildApiKeyUsageRows } from "./apiKeyUsageReport";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

function fmtLastUsed(iso) {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString();
}

export default function APIKeyUsageTab({ period }) {
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPath(`/api/usage/stats?period=${encodeURIComponent(period)}`));
      if (!res.ok) throw new Error(`Failed to load usage stats (${res.status})`);
      setStats(await res.json());
    } catch (err) {
      setError(err.message || "Failed to load usage stats");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const rows = useMemo(() => buildApiKeyUsageRows(stats, { query }), [stats, query]);
  const totals = useMemo(() => rows.reduce((acc, row) => ({
    requests: acc.requests + row.requests,
    promptTokens: acc.promptTokens + row.promptTokens,
    completionTokens: acc.completionTokens + row.completionTokens,
    totalTokens: acc.totalTokens + row.totalTokens,
    cost: acc.cost + row.cost,
  }), { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 }), [rows]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Usage by API key</h2>
            <p className="text-sm text-text-muted">
              Find which API keys used a provider or model during the selected period.
            </p>
          </div>
          <label className="flex w-full flex-col gap-1 md:w-80">
            <span className="text-xs font-semibold uppercase text-text-muted">Filter key, provider, or model</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="kimi, claude, Annie..."
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition-colors placeholder:text-text-muted focus:border-primary"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Metric label="Requests" value={fmt(totals.requests)} />
          <Metric label="Input" value={fmt(totals.promptTokens)} />
          <Metric label="Output" value={fmt(totals.completionTokens)} />
          <Metric label="Total Tokens" value={fmt(totals.totalTokens)} />
          <Metric label="Est. Cost" value={fmtCost(totals.cost)} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-bg-subtle/30 text-xs uppercase text-text-muted">
              <tr>
                <th className="px-4 py-3">API Key</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3 text-right">Requests</th>
                <th className="px-4 py-3 text-right">Input</th>
                <th className="px-4 py-3 text-right">Output</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3">Last Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-text-muted">Loading...</td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-danger">{error}</td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-text-muted">
                    No API-key usage found for this period or filter.
                  </td>
                </tr>
              )}
              {!loading && !error && rows.map((row) => (
                <tr key={row.id} className="hover:bg-bg-subtle/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.keyName}</div>
                    {row.apiKey && <div className="font-mono text-xs text-text-muted">{row.apiKey.slice(0, 12)}...</div>}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{row.provider}</td>
                  <td className="px-4 py-3 font-mono">{row.model}</td>
                  <td className="px-4 py-3 text-right">{fmt(row.requests)}</td>
                  <td className="px-4 py-3 text-right text-text-muted">{fmt(row.promptTokens)}</td>
                  <td className="px-4 py-3 text-right text-text-muted">{fmt(row.completionTokens)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{fmt(row.totalTokens)}</td>
                  <td className="px-4 py-3 text-right text-warning">{fmtCost(row.cost)}</td>
                  <td className="px-4 py-3 text-text-muted">{fmtLastUsed(row.lastUsed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle/30 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase text-text-muted">{label}</div>
      <div className="truncate text-lg font-semibold">{value}</div>
    </div>
  );
}

Metric.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
};

APIKeyUsageTab.propTypes = {
  period: PropTypes.string.isRequired,
};
