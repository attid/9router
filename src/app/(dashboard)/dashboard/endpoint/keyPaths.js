import { apiPath } from "../../../../lib/basePath.js";

export function buildKeyUsagePath(keyId) {
  return apiPath(`/api/keys/${keyId}/usage`);
}

export function buildKeyRoutePath(keyId) {
  return apiPath(`/api/keys/${keyId}`);
}
