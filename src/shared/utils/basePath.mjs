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
