import fs from "node:fs/promises";
import path from "node:path";
import {
  createUploadDisplayVariant,
  isOptimizableUploadFile,
  UPLOAD_DISPLAY_IMAGE_WIDTH,
  UPLOAD_DISPLAY_IMAGE_QUALITY
} from "../src/lib/uploads/optimized-images";

const uploadRoot = path.join(process.cwd(), "public", "uploads");
const concurrency = Math.max(1, Number(process.env.IMAGE_OPTIMIZE_CONCURRENCY || 4));
const force = process.argv.includes("--force");

type Counters = {
  created: number;
  fresh: number;
  notSmaller: number;
  unsupported: number;
  failed: number;
  originalBytes: number;
  optimizedBytes: number;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const files = await collectFiles(uploadRoot);
  const targets = files.filter(isOptimizableUploadFile);
  const counters: Counters = {
    created: 0,
    fresh: 0,
    notSmaller: 0,
    unsupported: 0,
    failed: 0,
    originalBytes: 0,
    optimizedBytes: 0
  };

  console.log(
    `Optimizing ${targets.length} upload images to ${UPLOAD_DISPLAY_IMAGE_WIDTH}px WebP q${UPLOAD_DISPLAY_IMAGE_QUALITY} with concurrency ${concurrency}${force ? " (force)" : ""}.`
  );

  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < targets.length) {
        const file = targets[cursor];
        cursor += 1;
        await optimizeOne(file, counters);
      }
    })
  );

  console.log(
    [
      `created=${counters.created}`,
      `fresh=${counters.fresh}`,
      `not_smaller=${counters.notSmaller}`,
      `unsupported=${counters.unsupported}`,
      `failed=${counters.failed}`,
      `saved=${formatBytes(counters.originalBytes - counters.optimizedBytes)}`
    ].join(" ")
  );

  if (counters.failed) process.exitCode = 1;
}

async function optimizeOne(file: string, counters: Counters) {
  try {
    const result = await createUploadDisplayVariant(file, { force });
    if (result.status === "created") {
      counters.created += 1;
      counters.originalBytes += result.originalBytes;
      counters.optimizedBytes += result.optimizedBytes;
      return;
    }

    if (result.reason === "fresh") counters.fresh += 1;
    if (result.reason === "not-smaller") counters.notSmaller += 1;
    if (result.reason === "unsupported") counters.unsupported += 1;
    counters.originalBytes += result.originalBytes ?? 0;
    counters.optimizedBytes += result.optimizedBytes ?? result.originalBytes ?? 0;
  } catch (error) {
    counters.failed += 1;
    console.error(`Failed to optimize ${path.relative(process.cwd(), file)}:`, error instanceof Error ? error.message : error);
  }
}

async function collectFiles(root: string) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (Math.abs(value) >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex ? 1 : 0)}${units[unitIndex]}`;
}
