"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, ModelSelectModal, Select } from "@/shared/components";
import { apiPath as withBasePath } from "@/shared/utils/basePath.mjs";
import {
  buildRequestPayload,
  extractAssistantText,
  fileToDataUrl,
  maskApiKey,
  MAX_IMAGE_SIZE_BYTES,
  scheduleRequestAbort,
} from "./chatTestUtils";

const KEY_STORAGE = "chatTest.selectedKeyId";
const STATE_STORAGE = "chatTest.state.v1";

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
  const [stateLoaded, setStateLoaded] = useState(false);
  const [keyHydrated, setKeyHydrated] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const imageLimitLabel = useMemo(
    () => `${Math.round(MAX_IMAGE_SIZE_BYTES / (1024 * 1024))}MB`,
    []
  );
  const activeApiKeys = useMemo(
    () => apiKeys.filter((key) => key?.isActive !== false),
    [apiKeys]
  );
  const selectedKey = useMemo(
    () => activeApiKeys.find((key) => key.id === selectedKeyId) || null,
    [activeApiKeys, selectedKeyId]
  );
  const keyOptions = useMemo(() => {
    const options = activeApiKeys.map((key) => ({
      value: key.id,
      label: `${key.name} (${maskApiKey(key.key)})`,
    }));
    if (!requireApiKey) options.unshift({ value: "__none__", label: "No API key" });
    return options;
  }, [activeApiKeys, requireApiKey]);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [providersResponse, aliasesResponse, settingsResponse, keysResponse] = await Promise.all([
          fetch(withBasePath("/api/providers")),
          fetch(withBasePath("/api/models/alias")),
          fetch(withBasePath("/api/settings")),
          fetch(withBasePath("/api/keys")),
        ]);

        if (providersResponse.ok) {
          const data = await providersResponse.json();
          setActiveProviders((data.connections || []).filter((connection) => connection.isActive !== false));
        }
        if (aliasesResponse.ok) {
          const data = await aliasesResponse.json();
          setModelAliases(data.aliases || {});
        }
        if (settingsResponse.ok) {
          const data = await settingsResponse.json();
          setRequireApiKey(data.requireApiKey === true);
        }
        if (keysResponse.ok) {
          const data = await keysResponse.json();
          const keys = data.keys || [];
          const savedKeyId = window.localStorage.getItem(KEY_STORAGE) || "";
          setApiKeys(keys);
          if (savedKeyId && keys.some((key) => key.id === savedKeyId && key.isActive !== false)) {
            setSelectedKeyId(savedKeyId);
          }
        }
      } catch {
        // The form remains usable when optional dashboard metadata is unavailable.
      } finally {
        setKeyHydrated(true);
      }
    }

    loadInitialData();
  }, []);

  useEffect(() => {
    if (!keyHydrated) return;
    if (selectedKeyId) window.localStorage.setItem(KEY_STORAGE, selectedKeyId);
    else window.localStorage.removeItem(KEY_STORAGE);
  }, [keyHydrated, selectedKeyId]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STATE_STORAGE) || "null");
      if (saved?.apiMode === "chat" || saved?.apiMode === "responses") setApiMode(saved.apiMode);
      if (typeof saved?.model === "string") setModel(saved.model);
      if (typeof saved?.prompt === "string") setPrompt(saved.prompt);
    } catch {
      // Ignore malformed or inaccessible browser storage.
    } finally {
      setStateLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!stateLoaded) return;
    try {
      window.localStorage.setItem(STATE_STORAGE, JSON.stringify({ apiMode, model, prompt }));
    } catch {
      // Ignore browser storage quota and privacy-mode failures.
    }
  }, [apiMode, model, prompt, stateLoaded]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError("");
    try {
      setImageDataUrl(await fileToDataUrl(file));
      setImageName(file.name);
    } catch (fileError) {
      setImageDataUrl(null);
      setImageName("");
      setError(fileError.message || "Failed to load image");
    }
  }

  function clearImage() {
    setImageDataUrl(null);
    setImageName("");
  }

  async function handleSend() {
    if (isSending) return;

    setIsSending(true);
    setError("");
    setResult(null);

    const controller = new AbortController();
    const cleanupAbort = scheduleRequestAbort(controller);

    try {
      if (requireApiKey && !selectedKeyId) throw new Error("Select API key");
      if (selectedKeyId && !selectedKey) throw new Error("Selected key is no longer available");

      const endpoint = apiMode === "responses"
        ? withBasePath("/api/v1/responses")
        : withBasePath("/api/v1/chat/completions");
      const headers = { "Content-Type": "application/json" };
      if (selectedKey?.key) headers.Authorization = `Bearer ${selectedKey.key}`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(buildRequestPayload({ apiMode, model, prompt, imageDataUrl })),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.error || data?.message || `HTTP ${response.status}`);
      }

      setResult({ text: extractAssistantText(apiMode, data), raw: data });
    } catch (requestError) {
      setError(requestError?.message || "Request failed");
    } finally {
      cleanupAbort();
      setIsSending(false);
    }
  }

  const sendDisabled = isSending || !model || !prompt.trim() || (requireApiKey && !selectedKeyId);

  return (
    <div className="space-y-6">
      <Card className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-text-main">Chat Test</h1>
          <p className="mt-1 text-sm text-text-muted">
            Send a single request to the Chat Completions or Responses endpoint.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-main">API Mode</label>
            <div className="flex flex-wrap gap-2">
              {[
                ["chat", "Chat Completions"],
                ["responses", "Responses"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-[10px] border px-3 py-2 text-sm transition-colors ${
                    apiMode === value
                      ? "border-brand-500/40 bg-brand-500/10 text-primary"
                      : "border-border-subtle bg-surface-2 text-text-muted hover:text-text-main"
                  }`}
                  onClick={() => setApiMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-text-main">Model</label>
            <div className="flex gap-2">
              <Input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Select or enter a model"
                className="flex-1"
              />
              <Button variant="secondary" onClick={() => setShowModelSelect(true)}>Choose</Button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-text-main">Prompt</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="Ask the model something"
            className="w-full rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 text-sm text-text-main transition-all focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>

        <Select
          label="API Key"
          options={keyOptions}
          value={selectedKeyId || (!requireApiKey ? "__none__" : "")}
          onChange={(event) => setSelectedKeyId(event.target.value === "__none__" ? "" : event.target.value)}
          placeholder={activeApiKeys.length ? "Select API key" : "No active API keys"}
          required={requireApiKey}
          hint={requireApiKey
            ? "Required by the current endpoint settings."
            : "Optional; select a key to test key-specific access."}
        />

        <div className="space-y-2">
          <label className="text-sm font-medium text-text-main">Image (optional)</label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer rounded-[10px] border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-main hover:bg-surface-3">
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              Upload image
            </label>
            {imageDataUrl && <Button variant="ghost" onClick={clearImage}>Remove image</Button>}
            <span className="text-xs text-text-muted">Max {imageLimitLabel}</span>
          </div>
          {imageName && <p className="text-xs text-text-muted">{imageName}</p>}
          {imageDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageDataUrl} alt="Selected upload" className="h-28 w-auto rounded-[10px] border border-border-subtle" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSend} disabled={sendDisabled} loading={isSending}>Send</Button>
          <span className="text-xs text-text-muted">Single-shot request with no conversation history or default timeout.</span>
        </div>

        {error && (
          <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
      </Card>

      {result && (
        <Card title="Response" className="space-y-3">
          <pre className="min-h-10 whitespace-pre-wrap rounded-[10px] border border-border-subtle bg-bg p-3 text-sm text-text-main">
            {result.text || "(No text extracted; see raw JSON below)"}
          </pre>
          <details>
            <summary className="cursor-pointer text-sm text-text-muted">Raw JSON</summary>
            <pre className="mt-2 overflow-auto rounded-[10px] border border-border-subtle bg-bg p-3 text-xs text-text-main">
              {JSON.stringify(result.raw, null, 2)}
            </pre>
          </details>
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
