export function safeInternalPath(value: string | null | undefined) {
  const rawPath = typeof value === "string" ? value.trim() : "";
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) return "";

  try {
    const parsed = new URL(rawPath, "http://mnemonic.local");
    if (parsed.origin !== "http://mnemonic.local") return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

export function safeReturnPath(value: string | null | undefined) {
  const path = safeInternalPath(value);
  if (!path || isAccountPath(path)) return "";
  return path;
}

export function authUrlWithNext(pathname: "/login" | "/register", next: string) {
  const params = new URLSearchParams();
  const safeNext = safeInternalPath(next);
  if (safeNext) params.set("next", safeNext);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function loginRequiredUrl(next: string) {
  const params = new URLSearchParams({ error: "required" });
  const safeNext = safeInternalPath(next);
  if (safeNext && safeNext !== "/me") params.set("next", safeNext);
  return `/login?${params.toString()}`;
}

export function registerUrlWithState(error: string, email: string, next: string) {
  const params = new URLSearchParams({ error });
  if (email) params.set("email", email);
  const safeNext = safeInternalPath(next);
  if (safeNext && safeNext !== "/me") params.set("next", safeNext);
  return `/register?${params.toString()}`;
}

export function pathWithReturn(pathname: "/me", from: string) {
  const safeFrom = safeReturnPath(from);
  if (!safeFrom || safeFrom === "/") return pathname;
  const params = new URLSearchParams({ from: safeFrom });
  return `${pathname}?${params.toString()}`;
}

export function pathFromReferer(referer: string | null, host: string | null) {
  if (!referer || !host) return "";

  try {
    const parsed = new URL(referer);
    if (parsed.host !== host) return "";
    return safeReturnPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
  } catch {
    return "";
  }
}

function isAccountPath(path: string) {
  return (
    path === "/login" ||
    path.startsWith("/login?") ||
    path === "/register" ||
    path.startsWith("/register?") ||
    path === "/forgot-password" ||
    path.startsWith("/forgot-password?") ||
    path === "/me" ||
    path.startsWith("/me?") ||
    path.startsWith("/me/")
  );
}
