import "server-only";
import crypto from "node:crypto";
import net from "node:net";

type HeaderReader = Pick<Headers, "get">;
const TRUSTED_PROXY_SECRET_HEADER = "x-mnemonic-proxy-secret";

export function clientIpFromHeaders(headers: HeaderReader) {
  if (!shouldTrustProxyHeaders(headers)) return undefined;

  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("true-client-ip"),
    headers.get("x-real-ip"),
    firstForwardedFor(headers.get("x-forwarded-for")),
    forwardedFor(headers.get("forwarded"))
  ];

  for (const candidate of candidates) {
    const ip = normalizeIp(candidate);
    if (ip) return ip;
  }

  return undefined;
}

export function clientIdentifierFromHeaders(headers: HeaderReader) {
  return clientIpFromHeaders(headers) ?? "unknown";
}

function firstForwardedFor(value: string | null) {
  return value?.split(",")[0]?.trim();
}

function forwardedFor(value: string | null) {
  if (!value) return undefined;
  const first = value.split(",")[0] ?? "";
  const match = /(?:^|;)\s*for=(?:"?\[?)([^;,"\]]+)/i.exec(first);
  return match?.[1]?.trim();
}

function normalizeIp(value: string | null | undefined) {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return net.isIP(cleaned) ? cleaned : undefined;
}

function shouldTrustProxyHeaders(headers: HeaderReader) {
  const secret = process.env.TRUSTED_PROXY_SECRET?.trim();
  if (!secret) return true;

  const received = headers.get(TRUSTED_PROXY_SECRET_HEADER)?.trim() ?? "";
  if (!received) return false;
  const receivedBuffer = Buffer.from(received);
  const secretBuffer = Buffer.from(secret);
  return receivedBuffer.length === secretBuffer.length && crypto.timingSafeEqual(receivedBuffer, secretBuffer);
}
