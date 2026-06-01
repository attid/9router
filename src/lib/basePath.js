/**
 * Base path support for serving the app under a sub-path (e.g. /9router).
 *
 * Reads BASE_PATH from environment. NEXT_PUBLIC_BASE_PATH wins (it survives
 * the Next.js bundler and is available on the client); BASE_PATH is the
 * server-side fallback. Trailing slashes are stripped.
 *
 * `apiPath()` and `dashboardPath()` build absolute URL paths that include the
 * prefix, are idempotent (passing an already-prefixed path is a no-op), and
 * accept paths with or without a leading slash.
 */
function normalize(raw) {
  if (!raw) return "";
  let p = String(raw).trim();
  if (!p) return "";
  if (!p.startsWith("/")) p = "/" + p;
  return p.replace(/\/+$/, "");
}

export const BASE_PATH = normalize(
  process.env.NEXT_PUBLIC_BASE_PATH ?? process.env.BASE_PATH ?? ""
);

export function withBasePath(path) {
  if (!BASE_PATH) {
    if (typeof path !== "string" || path === "") return path;
    return path.startsWith("/") ? path : "/" + path;
  }
  if (typeof path !== "string" || path === "") return BASE_PATH;
  const p = path.startsWith("/") ? path : "/" + path;
  if (p === BASE_PATH || p.startsWith(BASE_PATH + "/")) return p;
  return BASE_PATH + p;
}

// Named aliases keep call sites self-documenting.
export const apiPath = withBasePath;
export const dashboardPath = withBasePath;

export function absoluteApiUrl(baseUrl, path) {
  const base = String(baseUrl ?? "").replace(/\/+$/, "");
  return `${base}${apiPath(path)}`;
}
