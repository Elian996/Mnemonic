import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadRoot = path.join(process.cwd(), "public", "uploads");
const cacheHeaders = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff"
};

type UploadRouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(_request: Request, context: UploadRouteContext) {
  return serveUpload(context, false);
}

export async function HEAD(_request: Request, context: UploadRouteContext) {
  return serveUpload(context, true);
}

async function serveUpload(context: UploadRouteContext, headOnly: boolean) {
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
