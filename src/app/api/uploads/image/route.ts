import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { requireApiRole } from "@/lib/api-auth";
import { checkRateLimit, rateLimitKey, rateLimitResponse, requestRateLimitKey } from "@/lib/security/rate-limit";
import { createUploadDisplayVariant } from "@/lib/uploads/optimized-images";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_DATA_URL_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 10_000;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  const ipRateLimit = checkRateLimit({
    key: requestRateLimitKey("api:uploads:image:ip", request.headers),
    limit: 120,
    windowMs: 60 * 1000
  });
  if (!ipRateLimit.allowed) return rateLimitResponse("上传太频繁，请稍后再试。", ipRateLimit.retryAfterSeconds);

  const guard = await requireApiRole(UserRole.USER);
  if (guard.response) return guard.response;
  const userRateLimit = checkRateLimit({
    key: rateLimitKey("api:uploads:image:user", guard.user.id),
    limit: 40,
    windowMs: 10 * 60 * 1000
  });
  if (!userRateLimit.allowed) return rateLimitResponse("上传太频繁，请稍后再试。", userRateLimit.retryAfterSeconds);

  try {
    if (requestBodyTooLarge(request, MAX_IMAGE_BYTES + 1024 * 1024)) {
      return NextResponse.json({ error: "图片太大，请控制在 12MB 以内。" }, { status: 413 });
    }
    const formData = await request.formData();
    const file = formData.get("image");
    const imageUrl = String(formData.get("imageUrl") || "").trim();
    if (file instanceof File) {
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "图片太大，请控制在 12MB 以内。" }, { status: 413 });
      }
      return saveImageBytes({
        bytes: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type,
        originalName: file.name || "pasted-image"
      });
    }
    if (imageUrl) {
      return saveImageFromUrl(imageUrl);
    }

    return NextResponse.json({ error: "请粘贴或上传图片文件。" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "图片保存失败。";
    return NextResponse.json(
      { error: message },
      { status: message.includes("太大") ? 413 : 400 }
    );
  }
}

function requestBodyTooLarge(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

async function saveImageFromUrl(imageUrl: string) {
  if (imageUrl.startsWith("data:image/")) {
    const match = imageUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) return NextResponse.json({ error: "无法读取粘贴的图片数据。" }, { status: 400 });
    if (match[2].length > MAX_DATA_URL_CHARS) {
      return NextResponse.json({ error: "图片太大，请控制在 12MB 以内。" }, { status: 413 });
    }
    return saveImageBytes({
      bytes: Buffer.from(match[2], "base64"),
      mimeType: match[1],
      originalName: "pasted-image"
    });
  }

  const url = safeUrl(imageUrl);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return NextResponse.json({ error: "只支持 http 或 https 图片地址。" }, { status: 400 });
  }
  if (url.username || url.password) {
    return NextResponse.json({ error: "图片地址不能包含账号信息。" }, { status: 400 });
  }
  const blockedReason = await privateHostReason(url.hostname);
  if (blockedReason) {
    return NextResponse.json({ error: blockedReason }, { status: 400 });
  }

  const response = await fetch(url, {
    headers: { "User-Agent": "Mnemonic image importer" },
    redirect: "error",
    signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS)
  });
  if (!response.ok) {
    return NextResponse.json({ error: `图片地址读取失败：${response.status}` }, { status: 400 });
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "image/png";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "图片地址返回的不是图片文件。" }, { status: 400 });
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "图片太大，请控制在 12MB 以内。" }, { status: 413 });
  }

  return saveImageBytes({
    bytes: await readResponseBytes(response, MAX_IMAGE_BYTES),
    mimeType,
    originalName: path.basename(url.pathname) || "pasted-image"
  });
}

async function saveImageBytes({ bytes, mimeType, originalName }: { bytes: Buffer; mimeType: string; originalName: string }) {
  const normalizedMime = mimeType.split(";")[0]?.toLowerCase() || "";
  const detectedMime = detectImageMimeType(bytes);
  if (!detectedMime || (normalizedMime && (!ALLOWED_MIME_TYPES.has(normalizedMime) || detectedMime !== normalizedMime))) {
    return NextResponse.json({ error: "只能上传 png、jpg、webp 或 gif 图片。" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "图片太大，请控制在 12MB 以内。" }, { status: 413 });
  }

  const extension = extensionFromMime(detectedMime) ?? extensionFromName(originalName) ?? "png";
  const basename = safeFilename(originalName.replace(/\.[^.]+$/, "")) || "pasted-image";
  const filename = `${Date.now()}-${crypto.randomUUID()}-${basename}.${extension}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads", "editor");
  await fs.mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, filename);
  await fs.writeFile(filePath, bytes);
  await createUploadDisplayVariant(filePath).catch(() => undefined);

  return NextResponse.json({ url: `/uploads/editor/${filename}` }, { status: 201 });
}

function extensionFromMime(mimeType: string) {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("png")) return "png";
  return null;
}

function detectImageMimeType(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 6) {
    const signature = bytes.subarray(0, 6).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  return null;
}

function safeUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function privateHostReason(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return "不支持读取本机图片地址。";

  const directIp = net.isIP(normalized);
  const addresses = directIp
    ? [{ address: normalized }]
    : await dns.lookup(normalized, { all: true }).catch(() => []);
  if (!addresses.length) return "无法解析图片地址。";
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    return "不支持读取内网或本机图片地址。";
  }
  return "";
}

function isPrivateAddress(address: string) {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) {
    const parts = address.split(".").map((part) => Number(part));
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (ipVersion === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isPrivateAddress(normalized.slice("::ffff:".length));
    }
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }
  return true;
}

async function readResponseBytes(response: Response, maxBytes: number) {
  if (!response.body) return Buffer.from(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("图片太大，请控制在 12MB 以内。");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

function extensionFromName(filename: string) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1]?.replace(/[^a-z0-9]/g, "") || null;
}

function safeFilename(filename: string) {
  return filename.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}
