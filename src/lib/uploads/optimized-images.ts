import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const UPLOAD_DISPLAY_IMAGE_WIDTH = 720;
export const UPLOAD_DISPLAY_IMAGE_QUALITY = 78;
export const UPLOAD_DISPLAY_IMAGE_SUFFIX = ".display";

const uploadRoot = path.join(process.cwd(), "public", "uploads");
const optimizableExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

type DisplayVariantResult =
  | {
      status: "created";
      inputPath: string;
      outputPath: string;
      originalBytes: number;
      optimizedBytes: number;
    }
  | {
      status: "skipped";
      inputPath: string;
      outputPath: string;
      reason: "fresh" | "unsupported" | "not-smaller";
      originalBytes?: number;
      optimizedBytes?: number;
    };

export function uploadDisplayVariantUrl(sourceUrl: string) {
  const pathname = uploadPathnameFromUrl(sourceUrl);
  if (!pathname) return null;
  const extension = path.extname(pathname).toLowerCase();
  if (!optimizableExtensions.has(extension) || isDisplayVariantPathname(pathname)) return null;

  const parsed = path.parse(pathname);
  const variantPathname = path.posix.join(parsed.dir, `${parsed.name}${UPLOAD_DISPLAY_IMAGE_SUFFIX}.webp`);
  return variantPathname;
}

export async function existingUploadDisplayVariantUrl(sourceUrl: string) {
  const variantUrl = uploadDisplayVariantUrl(sourceUrl);
  if (!variantUrl) return null;
  const variantPath = uploadFilePathFromPathname(variantUrl);
  if (!variantPath) return null;
  const stat = await fs.stat(variantPath).catch(() => null);
  return stat?.isFile() ? variantUrl : null;
}

export function isOptimizableUploadFile(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (!optimizableExtensions.has(extension)) return false;
  return !path.basename(filePath, extension).endsWith(UPLOAD_DISPLAY_IMAGE_SUFFIX);
}

export function uploadDisplayVariantPath(filePath: string) {
  if (!isOptimizableUploadFile(filePath)) return null;
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${UPLOAD_DISPLAY_IMAGE_SUFFIX}.webp`);
}

export async function createUploadDisplayVariant(filePath: string, options: { force?: boolean } = {}): Promise<DisplayVariantResult> {
  const outputPath = uploadDisplayVariantPath(filePath);
  if (!outputPath) {
    return { status: "skipped", inputPath: filePath, outputPath: "", reason: "unsupported" };
  }

  const originalStat = await fs.stat(filePath);
  if (!options.force) {
    const outputStat = await fs.stat(outputPath).catch(() => null);
    if (outputStat?.isFile() && outputStat.mtimeMs >= originalStat.mtimeMs && outputStat.size > 0) {
      return {
        status: "skipped",
        inputPath: filePath,
        outputPath,
        reason: "fresh",
        originalBytes: originalStat.size,
        optimizedBytes: outputStat.size
      };
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  const info = await sharp(filePath, { animated: false })
    .rotate()
    .resize({
      width: UPLOAD_DISPLAY_IMAGE_WIDTH,
      height: UPLOAD_DISPLAY_IMAGE_WIDTH,
      fit: "inside",
      withoutEnlargement: true
    })
    .webp({ quality: UPLOAD_DISPLAY_IMAGE_QUALITY, effort: 4 })
    .toFile(temporaryPath);

  if (info.size >= Math.floor(originalStat.size * 0.9)) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    await fs.unlink(outputPath).catch(() => undefined);
    return {
      status: "skipped",
      inputPath: filePath,
      outputPath,
      reason: "not-smaller",
      originalBytes: originalStat.size,
      optimizedBytes: info.size
    };
  }

  await fs.rename(temporaryPath, outputPath);
  return {
    status: "created",
    inputPath: filePath,
    outputPath,
    originalBytes: originalStat.size,
    optimizedBytes: info.size
  };
}

function uploadPathnameFromUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let pathname = "";
  if (trimmed.startsWith("/")) {
    pathname = trimmed;
  } else {
    try {
      const url = new URL(trimmed);
      pathname = url.pathname;
    } catch {
      return null;
    }
  }

  if (!pathname.startsWith("/uploads/")) return null;
  const decoded = safeDecodePathname(pathname);
  if (!decoded) return null;
  const segments = decoded.split("/").filter(Boolean);
  if (segments[0] !== "uploads" || segments.slice(1).some((segment) => !safeUploadSegment(segment))) return null;
  return path.posix.join("/", ...segments);
}

function uploadFilePathFromPathname(pathname: string) {
  const decoded = safeDecodePathname(pathname);
  if (!decoded?.startsWith("/uploads/")) return null;
  const segments = decoded.split("/").filter(Boolean).slice(1);
  if (!segments.length || segments.some((segment) => !safeUploadSegment(segment))) return null;
  const resolved = path.resolve(uploadRoot, ...segments);
  const rootWithSeparator = `${uploadRoot}${path.sep}`;
  return resolved.startsWith(rootWithSeparator) ? resolved : null;
}

function safeDecodePathname(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function safeUploadSegment(segment: string) {
  return Boolean(segment) && segment !== "." && segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}

function isDisplayVariantPathname(pathname: string) {
  return path.basename(pathname, path.extname(pathname)).endsWith(UPLOAD_DISPLAY_IMAGE_SUFFIX);
}
