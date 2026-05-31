import "server-only";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { clientIdentifierFromHeaders } from "@/lib/security/client-ip";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult =
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; remaining: 0; resetAt: number; retryAfterSeconds: number };

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 20_000;
let cleanupCursor = 0;

export function checkRateLimit({ key, limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  cleanupExpiredBuckets(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

export function rateLimitKey(scope: string, identifier: string) {
  return `${scope}:${crypto.createHash("sha256").update(identifier).digest("base64url")}`;
}

export function requestRateLimitKey(scope: string, headers: Pick<Headers, "get">) {
  return rateLimitKey(scope, clientIdentifierFromHeaders(headers));
}

export function rateLimitResponse(message = "请求太频繁，请稍后再试。", retryAfterSeconds = 60) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Retry-After": String(retryAfterSeconds)
      }
    }
  );
}

function cleanupExpiredBuckets(now: number) {
  cleanupCursor = (cleanupCursor + 1) % 100;
  if (cleanupCursor !== 0 && buckets.size <= MAX_BUCKETS) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now || buckets.size > MAX_BUCKETS) buckets.delete(key);
    if (buckets.size <= MAX_BUCKETS && cleanupCursor !== 0) break;
  }
}
