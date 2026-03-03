"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select } from "@/shared/components";
import ModelSelectModal from "@/shared/components/ModelSelectModal";
import {
  buildRequestPayload,
  extractAssistantText,
  fileToDataUrl,
  MAX_IMAGE_SIZE_BYTES,
  maskApiKey,
} from "./chatTestUtils.js";

const KEY_STORAGE = "chatTest.selectedKeyId";

export default function ChatTestPageClient() {
  const [apiMode, setApiMode] = useState("chat");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [apiKeys, setApiKeys] = useState([]);
  const [selectedKeyId, setSelectedKeyId] = useState("");

  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [imageName, setImageName] = useState("");

  const [showModelSelect, setShowModelSelect] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const imageLimitLabel = useMemo(() => `${Math.round(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))}MB`, []);
  const activeApiKeys = useMemo(
    () => (apiKeys || []).filter((key) => key?.isActive !== false),
    [apiKeys]
  );
  const keyOptions = useMemo(() => {
    const options = activeApiKeys.map((key) => ({
      value: key.id,
      label: `${key.name} (${maskApiKey(key.key)})`,
    }));
    if (!requireApiKey) {
      options.unshift({ value: "__none__", label: "No API key" });
    }
    return options;
  }, [activeApiKeys, requireApiKey]);
  const selectedKey = useMemo(
    () => activeApiKeys.find((key) => key.id === selectedKeyId) || null,
    [activeApiKeys, selectedKeyId]
  );

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [providersRes, aliasesRes, settingsRes, keysRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/models/alias"),
          fetch("/api/settings"),
          fetch("/api/keys"),
        ]);

        if (providersRes.ok) {
          const providersData = await providersRes.json();
          setActiveProviders((providersData.connections || []).filter((c) => c.isActive !== false));
        }

        if (aliasesRes.ok) {
          const aliasesData = await aliasesRes.json();
          setModelAliases(aliasesData.aliases || {});
        }
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          setRequireApiKey(settingsData.requireApiKey === true);
        }
        if (keysRes.ok) {
          const keysData = await keysRes.json();
          const keys = keysData.keys || [];
          setApiKeys(keys);

          let savedKeyId = "";
          if (typeof window !== "undefined") {
            savedKeyId = window.localStorage.getItem(KEY_STORAGE) || "";
          }
          if (savedKeyId && keys.some((key) => key.id === savedKeyId && key.isActive !== false)) {
            setSelectedKeyId(savedKeyId);
          }
        }
      } catch {
        // Keep page interactive even if data load fails
      }
    };

    loadInitialData();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedKeyId) window.localStorage.setItem(KEY_STORAGE, selectedKeyId);
    else window.localStorage.removeItem(KEY_STORAGE);
  }, [selectedKeyId]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError("");
    try {
      const dataUrl = await fileToDataUrl(file, MAX_IMAGE_SIZE_BYTES);
      setImageDataUrl(dataUrl);
      setImageName(file.name);
    } catch (err) {
      setImageDataUrl(null);
      setImageName("");
      setError(err.message || "Failed to load image");
    }
  };

  const clearImage = () => {
    setImageDataUrl(null);
    setImageName("");
  };

  const handleSend = async () => {
    if (isSending) return;
    setIsSending(true);
    setError("");
    setResult(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const payload = buildRequestPayload({ apiMode, model, prompt, imageDataUrl });
      const endpoint = apiMode === "responses" ? "/api/v1/responses" : "/api/v1/chat/completions";
      if (requireApiKey && !selectedKeyId) {
        throw new Error("Select API key");
      }
      if (selectedKeyId && !selectedKey) {
        throw new Error("Selected key is no longer available");
      }

      const headers = { "Content-Type": "application/json" };
      if (selectedKey?.key) {
        headers.Authorization = `Bearer ${selectedKey.key}`;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.error?.message || data?.error || data?.message || `HTTP ${res.status}`;
        throw new Error(message);
      }

      const text = extractAssistantText(apiMode, data);
      setResult({ text, raw: data });
    } catch (err) {
      if (err?.name === "AbortError") {
        setError("Request timed out after 60s");
      } else {
        setError(err?.message || "Request failed");
      }
    } finally {
      clearTimeout(timeoutId);
      setIsSending(false);
    }
  };

  const isSendDisabled = isSending || !model || !prompt.trim() || (requireApiKey && !selectedKeyId);

  return (
    <div className="space-y-6">
      <Card>
        <div className="p-6 space-y-4">
          <div>
            <h1 className="text-xl font-semibold text-text-main">Chat Test</h1>
            <p className="text-sm text-text-muted mt-1">Single request test for chat/responses endpoints (no history).</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-main">API Mode</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`px-3 py-2 text-sm rounded-md border ${apiMode === "chat" ? "border-primary text-primary bg-primary/10" : "border-border text-text-muted"}`}
                  onClick={() => setApiMode("chat")}
                >
                  Chat Completions
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 text-sm rounded-md border ${apiMode === "responses" ? "border-primary text-primary bg-primary/10" : "border-border text-text-muted"}`}
                  onClick={() => setApiMode("responses")}
                >
                  Responses
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-main">Model</label>
              <div className="flex gap-2">
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Select model"
                  className="flex-1"
                />
                <Button variant="secondary" onClick={() => setShowModelSelect(true)}>
                  Choose
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-main">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="e.g. Привет, представься в 1 предложении"
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-2">
            <Select
              label="API Key"
              options={keyOptions}
              value={selectedKeyId || (!requireApiKey ? "__none__" : "")}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedKeyId(value === "__none__" ? "" : value);
              }}
              placeholder={activeApiKeys.length ? "Select API key" : "No active API keys"}
              required={requireApiKey}
              hint={
                requireApiKey
                  ? "Required: request auth is enabled in Settings."
                  : "Optional: auth disabled, choose a key only if you want to test key-specific access."
              }
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-main">Image (optional)</label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex">
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                <span className="px-3 py-2 text-sm rounded-md border border-border cursor-pointer hover:bg-surface/50">Upload file</span>
              </label>
              {imageDataUrl && (
                <Button variant="ghost" onClick={clearImage}>
                  Remove image
                </Button>
              )}
              <span className="text-xs text-text-muted">Max {imageLimitLabel}</span>
            </div>
            {imageName && <p className="text-xs text-text-muted">{imageName}</p>}
            {imageDataUrl && (
              <img src={imageDataUrl} alt="Selected" className="h-28 w-auto rounded-md border border-border" />
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleSend}
              disabled={isSendDisabled}
              loading={isSending}
            >
              Send
            </Button>
            <span className="text-xs text-text-muted">Request is always single-shot with no conversation context.</span>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-md border border-red-300 bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      </Card>

      {result && (
        <Card>
          <div className="p-6 space-y-3">
            <h2 className="text-lg font-semibold text-text-main">Response</h2>
            <pre className="whitespace-pre-wrap text-sm text-text-main bg-surface/50 border border-border rounded-md p-3 min-h-10">
              {result.text || "(No text extracted, see raw JSON below)"}
            </pre>

            <details>
              <summary className="cursor-pointer text-sm text-text-muted">Raw JSON</summary>
              <pre className="mt-2 text-xs overflow-auto bg-surface/50 border border-border rounded-md p-3">
                {JSON.stringify(result.raw, null, 2)}
              </pre>
            </details>
          </div>
        </Card>
      )}

      <ModelSelectModal
        isOpen={showModelSelect}
        onClose={() => setShowModelSelect(false)}
        onSelect={(selected) => setModel(selected.value || selected.id || "")}
        selectedModel={model}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
      />
    </div>
  );
}
