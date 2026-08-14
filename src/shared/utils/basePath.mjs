export function normalizeBasePath(value) {
  const segments = String(value ?? "")
    .trim()
    .split("/")
    .filter(Boolean);

  return segments.length > 0 ? `/${segments.join("/")}` : "";
}

function isNonLocalUrl(value) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}

export function apiPath(path, configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH) {
  const value = String(path ?? "");
  const basePath = normalizeBasePath(configuredBasePath);

  if (!basePath || !value || isNonLocalUrl(value)) return value;
  if (value === basePath || value.startsWith(`${basePath}/`) || value.startsWith(`${basePath}?`)) {
    return value;
  }

  return `${basePath}${value.startsWith("/") ? value : `/${value}`}`;
}

export function joinUrlPath(baseUrl, path) {
  const base = String(baseUrl ?? "").replace(/\/+$/, "");
  const suffix = String(path ?? "");
  if (!base) return suffix;
  if (!suffix) return base;
  return `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

export function appUrl(path, origin, configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH) {
  const value = String(path ?? "");
  if (isNonLocalUrl(value)) return value;

  const basePath = normalizeBasePath(configuredBasePath);
  let localPath = value
    ? apiPath(value, configuredBasePath)
    : basePath;
  try {
    const originPath = new URL(String(origin)).pathname.replace(/\/+$/, "");
    if (basePath && originPath === basePath && localPath.startsWith(basePath)) {
      localPath = localPath.slice(basePath.length);
    }
  } catch {
    // Invalid origins are handled by the caller; preserve joinUrlPath behavior.
  }
  return joinUrlPath(origin, localPath);
}
