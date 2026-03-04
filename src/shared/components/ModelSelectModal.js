"use client";

import { useState, useMemo, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { isModelHiddenForProvider } from "@/shared/utils/modelVisibility";

// Provider order: OAuth first, then API Key (matches dashboard/providers)
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  selectedModel,
  selectedModels = [],
  multiSelect = false,
  onConfirm,
  activeProviders = [],
  title = "Select Model",
  modelAliases = {},
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [combos, setCombos] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [dynamicModelsByProvider, setDynamicModelsByProvider] = useState({});
  const [hiddenModels, setHiddenModels] = useState({});
  const [internalSelected, setInternalSelected] = useState(new Set());

  // Sync internal state with prop when modal opens
  useEffect(() => {
    if (isOpen && multiSelect) {
      setInternalSelected(new Set(selectedModels || []));
    }
  }, [isOpen, multiSelect, selectedModels]);

  const toggleModel = (modelValue) => {
    setInternalSelected(prev => {
      const next = new Set(prev);
      if (next.has(modelValue)) next.delete(modelValue);
      else next.add(modelValue);
      return next;
    });
  };

  const fetchCombos = async () => {
    try {
      const res = await fetch("/api/combos");
      if (!res.ok) throw new Error(`Failed to fetch combos: ${res.status}`);
      const data = await res.json();
      setCombos(data.combos || []);
    } catch (error) {
      console.error("Error fetching combos:", error);
      setCombos([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchCombos();
  }, [isOpen]);

  const fetchProviderNodes = async () => {
    try {
      const res = await fetch("/api/provider-nodes");
      if (!res.ok) throw new Error(`Failed to fetch provider nodes: ${res.status}`);
      const data = await res.json();
      setProviderNodes(data.nodes || []);
    } catch (error) {
      console.error("Error fetching provider nodes:", error);
      setProviderNodes([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchProviderNodes();
  }, [isOpen]);

  const fetchHiddenModels = async () => {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`Failed to fetch settings: ${res.status}`);
      const data = await res.json();
      setHiddenModels(data.hiddenModels || {});
    } catch (error) {
      console.error("Error fetching hidden models:", error);
      setHiddenModels({});
    }
  };

  useEffect(() => {
    if (isOpen) fetchHiddenModels();
  }, [isOpen]);

  const fetchDynamicModels = async () => {
    try {
      const activeConnections = (activeProviders || []).filter((c) => c?.id && c?.provider);
      if (!activeConnections.length) {
        setDynamicModelsByProvider({});
        return;
      }

      const settled = await Promise.allSettled(
        activeConnections.map(async (conn) => {
          const res = await fetch(`/api/providers/${encodeURIComponent(conn.id)}/models`);
          if (!res.ok) return { provider: conn.provider, models: [] };
          const data = await res.json();
          const normalized = (data.models || [])
            .map((m) => {
              if (typeof m === "string") return { id: m, name: m };
              const id = m?.id || m?.model || m?.name;
              if (!id) return null;
              return { id, name: m?.name || m?.displayName || id };
            })
            .filter(Boolean);
          return { provider: conn.provider, models: normalized };
        })
      );

      const byProvider = {};
      for (const r of settled) {
        if (r.status !== "fulfilled") continue;
        const providerId = r.value.provider;
        if (!byProvider[providerId]) byProvider[providerId] = new Map();
        for (const model of r.value.models) {
          byProvider[providerId].set(model.id, model.name);
        }
      }

      const finalMap = {};
      Object.entries(byProvider).forEach(([providerId, modelsMap]) => {
        finalMap[providerId] = [...modelsMap.entries()].map(([id, name]) => ({ id, name }));
      });
      setDynamicModelsByProvider(finalMap);
    } catch (error) {
      console.error("Error fetching dynamic provider models:", error);
      setDynamicModelsByProvider({});
    }
  };

  useEffect(() => {
    if (isOpen) fetchDynamicModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeProviders]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  // Group models by provider with priority order
  const groupedModels = useMemo(() => {
    const groups = {};
    
    // Get all active provider IDs from connections
    const activeConnectionIds = activeProviders.map(p => p.provider);
    
    // Only show connected providers (including both standard and custom)
    const providerIdsToShow = new Set([
      ...activeConnectionIds,  // Only connected providers
    ]);

    // Sort by PROVIDER_ORDER
    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedProviderIds.forEach((providerId) => {
      const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
      const dynamicModels = dynamicModelsByProvider[providerId] || [];

      const mergeModels = (baseModels = []) => {
        const merged = new Map();
        for (const m of baseModels) merged.set(m.id, m);
        for (const dm of dynamicModels) {
          if (!merged.has(dm.id)) {
            merged.set(dm.id, {
              id: dm.id,
              name: dm.name || dm.id,
              value: `${alias}/${dm.id}`,
            });
          }
        }
        return [...merged.values()].filter(
          (m) =>
            !isModelHiddenForProvider(hiddenModels, {
              aliasKey: alias,
              providerIdKey: providerId,
              modelId: m.id,
            })
        );
      };
      
      if (providerInfo.passthroughModels) {
        const aliasModelsBase = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${alias}/`, ""),
            name: aliasName,
            value: fullModel,
          }));
        const aliasModels = mergeModels(aliasModelsBase);
        
        if (aliasModels.length > 0) {
          // Check for custom name from providerNodes (for compatible providers)
          const matchedNode = providerNodes.find(node => node.id === providerId);
          const displayName = matchedNode?.name || providerInfo.name;
          
          groups[providerId] = {
            name: displayName,
            alias: alias,
            color: providerInfo.color,
            models: aliasModels,
          };
        }
      } else if (isCustomProvider) {
        // Match provider node to get custom name
        const matchedNode = providerNodes.find(node => node.id === providerId);
        const displayName = matchedNode?.name || providerInfo.name;
        
        // Get models from modelAliases using providerId (not prefix)
        // modelAliases format: { alias: "providerId/modelId" }
        const nodeModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${providerId}/`, ""),
            name: aliasName,
            value: fullModel,
          }));
        const mergedNodeModels = mergeModels(nodeModels);
        
        // Only add to groups if there are models (consistent with other provider types)
        if (mergedNodeModels.length > 0) {
          groups[providerId] = {
            name: displayName,
            alias: matchedNode?.prefix || providerId,
            color: providerInfo.color,
            models: mergedNodeModels,
            isCustom: true,
            hasModels: true,
          };
        }
      } else {
        const staticModels = getModelsByProviderId(providerId);
        const models = mergeModels(staticModels.map((m) => ({
          id: m.id,
          name: m.name,
          value: `${alias}/${m.id}`,
        })));
        if (models.length > 0) {
          groups[providerId] = {
            name: providerInfo.name,
            alias: alias,
            color: providerInfo.color,
            models,
          };
        }
      }
    });

    return groups;
  }, [activeProviders, modelAliases, allProviders, providerNodes, dynamicModelsByProvider, hiddenModels]);

  // Filter combos by search query
  const filteredCombos = useMemo(() => {
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter(c => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery]);

  // Filter models by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedModels;

    const query = searchQuery.toLowerCase();
    const filtered = {};

    Object.entries(groupedModels).forEach(([providerId, group]) => {
      const matchedModels = group.models.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query)
      );

      const providerNameMatches = group.name.toLowerCase().includes(query);
      
      if (matchedModels.length > 0 || providerNameMatches) {
        filtered[providerId] = {
          ...group,
          models: matchedModels,
        };
      }
    });

    return filtered;
  }, [groupedModels, searchQuery]);

  const handleSelect = (model) => {
    onSelect(model);
    onClose();
    setSearchQuery("");
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        setSearchQuery("");
      }}
      title={title}
      size="md"
      className="p-4!"
    >
      {/* Search - compact */}
      <div className="mb-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Models grouped by provider - compact */}
      <div className="max-h-[300px] overflow-y-auto space-y-3">
        {/* Combos section - always first */}
        {filteredCombos.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <span className="material-symbols-outlined text-primary text-[14px]">layers</span>
              <span className="text-xs font-medium text-primary">Combos</span>
              <span className="text-[10px] text-text-muted">({filteredCombos.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCombos.map((combo) => {
                const isSelected = multiSelect ? internalSelected.has(combo.name) : selectedModel === combo.name;
                return (
                  <button
                    key={combo.id}
                    onClick={() => multiSelect
                      ? toggleModel(combo.name)
                      : handleSelect({ id: combo.name, name: combo.name, value: combo.name })
                    }
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer
                      ${isSelected
                        ? "bg-primary text-white border-primary"
                        : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    {multiSelect && (
                      <span className="material-symbols-outlined text-[12px] mr-0.5">
                        {internalSelected.has(combo.name) ? "check_box" : "check_box_outline_blank"}
                      </span>
                    )}
                    {combo.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Provider models */}
        {Object.entries(filteredGroups).map(([providerId, group]) => (
          <div key={providerId}>
            {/* Provider header */}
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <span className="text-xs font-medium text-primary">
                {group.name}
              </span>
              <span className="text-[10px] text-text-muted">
                ({group.models.length})
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {group.models.map((model) => {
                const isSelected = multiSelect ? internalSelected.has(model.value) : selectedModel === model.value;
                return (
                  <button
                    key={model.id}
                    onClick={() => multiSelect
                      ? toggleModel(model.value)
                      : handleSelect(model)
                    }
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer
                      ${isSelected
                        ? "bg-primary text-white border-primary"
                        : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    {multiSelect && (
                      <span className="material-symbols-outlined text-[12px] mr-0.5">
                        {internalSelected.has(model.value) ? "check_box" : "check_box_outline_blank"}
                      </span>
                    )}
                    {model.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && (
          <div className="text-center py-4 text-text-muted">
            <span className="material-symbols-outlined text-2xl mb-1 block">
              search_off
            </span>
            <p className="text-xs">No models found</p>
          </div>
        )}
      </div>

      {multiSelect && (
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {internalSelected.size} model{internalSelected.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setInternalSelected(new Set());
              }}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-main transition-colors"
            >
              Clear all
            </button>
            <button
              onClick={() => {
                onConfirm?.([...internalSelected]);
                onClose();
              }}
              className="px-4 py-1.5 bg-primary text-white rounded text-xs font-medium hover:bg-primary-hover transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

ModelSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func,
  selectedModel: PropTypes.string,
  selectedModels: PropTypes.arrayOf(PropTypes.string),
  multiSelect: PropTypes.bool,
  onConfirm: PropTypes.func,
  activeProviders: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
    })
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
};
