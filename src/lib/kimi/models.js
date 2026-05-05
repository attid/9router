import { buildKimiHeaders } from "./headers.js";
import { refreshTokenByProvider, updateProviderCredentials } from "../../sse/services/tokenRefresh.js";

export const KIMI_CODING_MODELS_URL = "https://api.kimi.com/coding/v1/models";

async function fetchKimiModelsResponse(accessToken) {
  return fetch(KIMI_CODING_MODELS_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...buildKimiHeaders(),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function fetchKimiCodingModels(connection) {
  if (!connection?.accessToken) {
    throw new Error("No valid token found");
  }

  let response = await fetchKimiModelsResponse(connection.accessToken);

  if (response.status === 401 && connection.refreshToken) {
    const refreshed = await refreshTokenByProvider("kimi-coding", connection);
    if (refreshed?.accessToken) {
      await updateProviderCredentials(connection.id, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || connection.refreshToken,
        expiresIn: refreshed.expiresIn,
      });
      response = await fetchKimiModelsResponse(refreshed.accessToken);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Failed to fetch models: ${response.status}`);
    error.status = response.status;
    error.body = errorText;
    throw error;
  }

  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}

export function extractKimiCodingModelIds(models) {
  return Array.from(
    new Set(
      (models || [])
        .map((model) => model?.id || model?.name || model?.model)
        .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "")
    )
  );
}
