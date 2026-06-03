export function isBlockedHotlink(request: Request) {
  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    const refererOrigin = new URL(referer).origin;
    return !allowedHotlinkOrigins(request).has(refererOrigin);
  } catch {
    return false;
  }
}

function allowedHotlinkOrigins(request: Request) {
  const origins = new Set<string>();
  addOrigin(origins, request.url);
  addRequestHeaderOrigin(origins, request, "host");
  addRequestHeaderOrigin(origins, request, "x-forwarded-host");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) addOrigin(origins, appUrl);

  for (const value of (process.env.UPLOAD_HOTLINK_ALLOWED_ORIGINS || "").split(",")) {
    addOrigin(origins, value.trim());
  }
  return origins;
}

function addRequestHeaderOrigin(origins: Set<string>, request: Request, headerName: string) {
  const host = firstHeaderValue(request.headers.get(headerName));
  if (!host) return;
  const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? requestProtocol(request);
  addOrigin(origins, `${protocol}://${host}`);
}

function addOrigin(origins: Set<string>, value: string) {
  if (!value) return;
  try {
    origins.add(new URL(value).origin);
  } catch {
    // Ignore invalid deployment hints; request-derived origins still work.
  }
}

function requestProtocol(request: Request) {
  try {
    return new URL(request.url).protocol.replace(/:$/u, "") || "http";
  } catch {
    return "http";
  }
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}
