export function formatAccessTokenExpiry(expiresAt, now = Date.now()) {
  if (!expiresAt) return "unknown";

  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) return "unknown";

  const diffMs = target - now;
  const absMinutes = Math.floor(Math.abs(diffMs) / 60000);

  if (diffMs >= 0) {
    if (absMinutes < 60) return `expires in ${absMinutes}m`;
    const hours = Math.floor(absMinutes / 60);
    return `expires in ${hours}h`;
  }

  if (absMinutes < 60) return `expired ${absMinutes}m ago`;
  const hours = Math.floor(absMinutes / 60);
  return `expired ${hours}h ago`;
}

export function formatSessionExpiry(idTokenClaims) {
  const exp = idTokenClaims?.exp;
  if (!exp) return null;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(exp * 1000));
}

export function getRefreshTokenStatus(tokenInfo) {
  return tokenInfo?.hasRefreshToken
    ? { tone: "success", label: "refresh token available" }
    : { tone: "error", label: "refresh token missing" };
}
