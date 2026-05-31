import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadRoot = path.join(process.cwd(), "public", "uploads");
const cacheHeaders = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
  "Vary": "Referer"
};

type UploadRouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(request: Request, context: UploadRouteContext) {
  return serveUpload(request, context, false);
}

export async function HEAD(request: Request, context: UploadRouteContext) {
  return serveUpload(request, context, true);
}

async function serveUpload(request: Request, context: UploadRouteContext, headOnly: boolean) {
  if (isBlockedHotlink(request)) {
    return new NextResponse(null, { status: 403, headers: { "Cache-Control": "private, no-store", "Vary": "Referer" } });
  }

  const { path: pathSegments } = await context.params;
  const filePath = resolveUploadPath(pathSegments);
  if (!filePath) return new NextResponse(null, { status: 404 });

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) return new NextResponse(null, { status: 404 });

  const headers = {
    ...cacheHeaders,
    "Content-Length": String(stat.size),
    "Content-Type": contentType(filePath),
    "Last-Modified": stat.mtime.toUTCString()
  };

  if (headOnly) return new NextResponse(null, { status: 200, headers });

  const bytes = await fs.readFile(filePath);
  return new NextResponse(bytes, { status: 200, headers });
}

function resolveUploadPath(pathSegments: string[]) {
  if (!pathSegments.length) return null;
  if (pathSegments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\"))) {
    return null;
  }

  const resolved = path.resolve(uploadRoot, ...pathSegments);
  const rootWithSeparator = `${uploadRoot}${path.sep}`;
  return resolved === uploadRoot || resolved.startsWith(rootWithSeparator) ? resolved : null;
}

function contentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "application/octet-stream";
}

function isBlockedHotlink(request: Request) {
  const referer = request.headers.get("referer");
  if (!referer) return false;

  try {
    const refererOrigin = new URL(referer).origin;
    const requestOrigin = new URL(request.url).origin;
    return refererOrigin !== requestOrigin && !allowedHotlinkOrigins().has(refererOrigin);
  } catch {
    return false;
  }
}

function allowedHotlinkOrigins() {
  const origins = new Set<string>();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      origins.add(new URL(appUrl).origin);
    } catch {
      // Ignore invalid deployment hints; the request origin still works.
    }
  }

  for (const value of (process.env.UPLOAD_HOTLINK_ALLOWED_ORIGINS || "").split(",")) {
    const origin = value.trim();
    if (!origin) continue;
    try {
      origins.add(new URL(origin).origin);
    } catch {
      // Ignore invalid optional origins.
    }
  }
  return origins;
}
