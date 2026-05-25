import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  MnemonicStatus,
  Prisma,
  UserRole,
  type LevelTag,
  type MnemonicSourceType
} from "@prisma/client";
import { prisma } from "../src/lib/db";
import { markdownToPlainText, renderMnemonicMarkdown } from "../src/lib/wiki-links/renderer";

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");
const limit = numberArg("--limit") ?? Number.POSITIVE_INFINITY;
const offset = numberArg("--offset") ?? 0;
const delayMs = numberArg("--delay-ms") ?? 13_000;
const maxRetries = numberArg("--max-retries") ?? 3;
const requestTimeoutMs = numberArg("--request-timeout-ms") ?? 300_000;
const onlyWord = stringArg("--word")?.toLowerCase();
const onlyEntryId = stringArg("--entry-id");
const localImagePath = stringArg("--image-path") ?? stringArg("--insert-image-path");
const localImageManifestPath = stringArg("--image-manifest");
const imageModel = stringArg("--model") ?? firstFilled(process.env.AI_IMAGE_MODEL, "gpt-image-2");
const imageBaseUrl = firstFilled(process.env.AI_IMAGE_BASE_URL, "https://api.openai.com/v1");
const imageApiKey = firstFilled(process.env.AI_IMAGE_API_KEY, process.env.OPENAI_API_KEY);
const imageSize = enumArg("--size", ["1024x1024", "1024x1536", "1536x1024", "auto"], "1024x1024");
const imageQuality = enumArg("--quality", ["low", "medium", "high", "auto"], "medium");
const outputFormat = enumArg("--output-format", ["png", "webp", "jpeg"], "webp");
const actorEmail = process.env.MNEMONIC_CLEANUP_ACTOR_EMAIL ?? "maoshangjian2021@163.com";
const missingReportPath =
  stringArg("--missing-report") ??
  path.join(process.cwd(), "tmp", "mnemonic-missing-images", "latest.json");
const runDir = path.join(process.cwd(), "tmp", "mnemonic-generated-images");
const backupDir = path.join(process.cwd(), "tmp", "backups");
const checkpointPath = stringArg("--checkpoint") ?? path.join(runDir, "checkpoint.json");
const uploadDir = path.join(process.cwd(), "public", "uploads", "generated-mnemonic-images");
const uploadUrlPrefix = "/uploads/generated-mnemonic-images";
const marker = "codex-generated-mnemonic-image-2026-05-24";
const renderedImagePattern = /!\[[^\]]*\]\([^)]+\)|<img\b|<figure\b|data:image\//i;
const cuePattern =
  /如下图|如上图|如图|下图|上图|图中|图里|图上|图下|图所示|所示(?:的)?图|见图|看图|这张图|那张图|这幅图|那幅图|图片中|图中的|图上的|图下的|箭头所示|图中箭头|示意图|(?:^|\n)\s*(?:#{1,6}\s*)?(?:图片|配图|图示|示意图)\s*[:：]/u;

type MissingImageItem = {
  entryId: string;
  wordId: string;
  word: string;
  slug: string;
  levelTags: LevelTag[];
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  cueMatches: string[];
  preview: string;
  reason: string;
  contentMarkdown: string;
};

type MissingImageReport = {
  version: 1;
  status: "complete";
  createdAt: string;
  updatedAt: string;
  totalEntries: number;
  scannedEntries: number;
  imageBackedEntries: number;
  candidateEntries: number;
  rules: string[];
  items: MissingImageItem[];
};

type Entry = {
  id: string;
  title: string;
  splitText: string | null;
  contentMarkdown: string;
  contentHtml: string;
  editorNote: string | null;
  sourceType: MnemonicSourceType;
  status: MnemonicStatus;
  targetWord: {
    id: string;
    word: string;
    slug: string;
    partOfSpeech: string;
    meaningCn: string;
    shortMeaningCn: string;
    meaningEn: string | null;
    levelTags: LevelTag[];
  };
};

type Target = {
  entry: Entry;
  missingItem: MissingImageItem;
  prompt: string;
};

type GeneratedItem = {
  entryId: string;
  word: string;
  slug: string;
  prompt: string;
  status: "planned" | "generated" | "skipped" | "failed";
  reason?: string;
  imagePath?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  outputFormat?: string;
  generatedAt?: string;
};

type RunReport = {
  version: 1;
  mode: "dry-run" | "apply";
  status: "planned" | "running" | "complete";
  createdAt: string;
  updatedAt: string;
  sourceReportPath: string;
  model: string;
  size: string;
  quality: string;
  outputFormat: string;
  targetCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  backupPath: string | null;
  items: GeneratedItem[];
};

type Checkpoint = {
  doneEntryIds: string[];
};

type LocalImageManifestItem = {
  index?: number;
  word: string;
  entryId: string;
  imagePath: string;
};

async function main() {
  await fsp.mkdir(runDir, { recursive: true });
  if (localImagePath && localImageManifestPath) {
    throw new Error("请只传 --image-path 或 --image-manifest 其中一个。");
  }
  const localImageManifest = localImageManifestPath
    ? await loadLocalImageManifest(localImageManifestPath)
    : null;
  const localManifestEntryIds = localImageManifest
    ? new Set(localImageManifest.map((item) => item.entryId))
    : null;
  const isLocalInsert = Boolean(localImagePath || localImageManifest);
  const isWriteMode = apply || isLocalInsert;
  const actor = isWriteMode ? await resolveActor() : null;
  if (apply && !isLocalInsert && !imageApiKey) {
    throw new Error("Missing image API key. Fill AI_IMAGE_API_KEY or OPENAI_API_KEY.");
  }

  const targets = await loadTargets(localManifestEntryIds);
  const orderedTargets = localImageManifest
    ? orderTargetsByLocalManifest(targets, localImageManifest)
    : targets;
  const selectedTargets = localImageManifest
    ? orderedTargets
    : orderedTargets.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
  const checkpoint = readCheckpoint(checkpointPath);
  const doneIds = new Set(force ? [] : checkpoint.doneEntryIds);
  const runnableTargets = selectedTargets.filter((target) => !doneIds.has(target.entry.id));
  const backupPath =
    isWriteMode && runnableTargets.length ? await writeBackup(runnableTargets) : null;
  const reportPath = path.join(
    runDir,
    `run-${isWriteMode ? "apply" : "dry-run"}-${Date.now()}.json`
  );
  const latestReportPath = path.join(runDir, "latest.json");
  const runReport: RunReport = {
    version: 1,
    mode: isWriteMode ? "apply" : "dry-run",
    status: isWriteMode ? "running" : "planned",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceReportPath: missingReportPath,
    model: imageModel,
    size: imageSize,
    quality: imageQuality,
    outputFormat,
    targetCount: runnableTargets.length,
    completedCount: 0,
    failedCount: 0,
    skippedCount: selectedTargets.length - runnableTargets.length,
    backupPath,
    items: []
  };

  console.log(`模式：${isLocalInsert ? "LOCAL INSERT" : apply ? "APPLY" : "DRY RUN"}`);
  console.log(`来源清单：${missingReportPath}`);
  console.log(`模型：${imageModel} (${imageSize}, ${imageQuality}, ${outputFormat})`);
  console.log(`待处理：${runnableTargets.length} / 已跳过 checkpoint：${runReport.skippedCount}`);
  if (actor) console.log(`执行账号：${actor.username} <${actor.email}>`);
  if (backupPath) console.log(`备份：${backupPath}`);

  if (!isWriteMode) {
    runReport.items = runnableTargets.map((target) => ({
      entryId: target.entry.id,
      word: target.entry.targetWord.word,
      slug: target.entry.targetWord.slug,
      prompt: target.prompt,
      status: "planned"
    }));
    await writeReports(runReport, reportPath, latestReportPath);
    printPromptPreview(runnableTargets);
    console.log(`报告：${reportPath}`);
    return;
  }

  await fsp.mkdir(uploadDir, { recursive: true });
  await writeReports(runReport, reportPath, latestReportPath);

  if (localImagePath) {
    if (runnableTargets.length !== 1) {
      throw new Error(
        "使用 --image-path 插入本地图片时，请同时传 --entry-id=... 或 --word=... 精确到一张卡。"
      );
    }
    const target = runnableTargets[0];
    const imageBytes = await fsp.readFile(path.resolve(localImagePath));
    const saved = await saveGeneratedImage(target, imageBytes);
    await applySavedImageToEntry({
      target,
      saved,
      actor,
      backupPath,
      reportPath,
      source: "built-in-imagegen"
    });
    doneIds.add(target.entry.id);
    await writeCheckpoint(checkpointPath, { doneEntryIds: Array.from(doneIds) });
    runReport.completedCount = 1;
    runReport.items.push({
      entryId: target.entry.id,
      word: target.entry.targetWord.word,
      slug: target.entry.targetWord.slug,
      prompt: target.prompt,
      status: "generated",
      imagePath: saved.imagePath,
      imageUrl: saved.imageUrl,
      width: saved.width,
      height: saved.height,
      outputFormat,
      generatedAt: new Date().toISOString()
    });
    runReport.status = "complete";
    await writeReports(runReport, reportPath, latestReportPath);
    console.log(
      JSON.stringify(
        { mode: "local-insert", imageUrl: saved.imageUrl, backupPath, reportPath },
        null,
        2
      )
    );
    return;
  }

  if (localImageManifest) {
    const imageByEntryId = new Map(
      localImageManifest.map((item) => [item.entryId, item.imagePath] as const)
    );
    for (const target of runnableTargets) {
      const imagePath = imageByEntryId.get(target.entry.id);
      if (!imagePath) {
        runReport.failedCount += 1;
        runReport.items.push({
          entryId: target.entry.id,
          word: target.entry.targetWord.word,
          slug: target.entry.targetWord.slug,
          prompt: target.prompt,
          status: "failed",
          reason: "Local image manifest has no image path for this entry."
        });
        continue;
      }

      try {
        const imageBytes = await fsp.readFile(imagePath);
        const saved = await saveGeneratedImage(target, imageBytes);
        await applySavedImageToEntry({
          target,
          saved,
          actor,
          backupPath,
          reportPath,
          source: "built-in-imagegen"
        });
        doneIds.add(target.entry.id);
        runReport.completedCount += 1;
        runReport.items.push({
          entryId: target.entry.id,
          word: target.entry.targetWord.word,
          slug: target.entry.targetWord.slug,
          prompt: target.prompt,
          status: "generated",
          imagePath: saved.imagePath,
          imageUrl: saved.imageUrl,
          width: saved.width,
          height: saved.height,
          outputFormat,
          generatedAt: new Date().toISOString()
        });
        await writeCheckpoint(checkpointPath, { doneEntryIds: Array.from(doneIds) });
        await writeReports(runReport, reportPath, latestReportPath);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        runReport.failedCount += 1;
        runReport.items.push({
          entryId: target.entry.id,
          word: target.entry.targetWord.word,
          slug: target.entry.targetWord.slug,
          prompt: target.prompt,
          status: "failed",
          reason
        });
        await writeReports(runReport, reportPath, latestReportPath);
      }
    }

    runReport.status = "complete";
    await writeReports(runReport, reportPath, latestReportPath);
    console.log(
      JSON.stringify(
        {
          mode: "local-manifest-insert",
          completed: runReport.completedCount,
          failed: runReport.failedCount,
          skipped: runReport.skippedCount,
          backupPath,
          reportPath,
          latestReportPath
        },
        null,
        2
      )
    );
    return;
  }

  for (let index = 0; index < runnableTargets.length; index += 1) {
    const target = runnableTargets[index];
    const label = `${index + 1}/${runnableTargets.length} ${target.entry.targetWord.word}`;
    try {
      console.log(`生成：${label}`);
      const generated = await generateImageWithRetries(target.prompt);
      const saved = await saveGeneratedImage(target, generated);
      await applySavedImageToEntry({
        target,
        saved,
        actor,
        backupPath,
        reportPath,
        source: "image-api"
      });

      doneIds.add(target.entry.id);
      await writeCheckpoint(checkpointPath, { doneEntryIds: Array.from(doneIds) });
      runReport.completedCount += 1;
      runReport.items.push({
        entryId: target.entry.id,
        word: target.entry.targetWord.word,
        slug: target.entry.targetWord.slug,
        prompt: target.prompt,
        status: "generated",
        imagePath: saved.imagePath,
        imageUrl: saved.imageUrl,
        width: saved.width,
        height: saved.height,
        outputFormat,
        generatedAt: new Date().toISOString()
      });
      await writeReports(runReport, reportPath, latestReportPath);

      if (index < runnableTargets.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`失败：${label}：${reason}`);
      runReport.failedCount += 1;
      runReport.items.push({
        entryId: target.entry.id,
        word: target.entry.targetWord.word,
        slug: target.entry.targetWord.slug,
        prompt: target.prompt,
        status: "failed",
        reason
      });
      await writeReports(runReport, reportPath, latestReportPath);
    }
  }

  runReport.status = "complete";
  await writeReports(runReport, reportPath, latestReportPath);
  console.log(
    JSON.stringify(
      {
        mode: "apply",
        completed: runReport.completedCount,
        failed: runReport.failedCount,
        skipped: runReport.skippedCount,
        backupPath,
        reportPath,
        latestReportPath
      },
      null,
      2
    )
  );
}

async function loadTargets(onlyEntryIds?: Set<string> | null) {
  const report = JSON.parse(await fsp.readFile(missingReportPath, "utf8")) as MissingImageReport;
  const reportItems = report.items
    .filter((item) => !onlyEntryIds || onlyEntryIds.has(item.entryId))
    .filter((item) => !onlyWord || item.word.toLowerCase() === onlyWord)
    .filter((item) => !onlyEntryId || item.entryId === onlyEntryId);
  if (!reportItems.length) return [];

  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      id: { in: reportItems.map((item) => item.entryId) },
      status: { not: MnemonicStatus.ARCHIVED }
    },
    select: {
      id: true,
      title: true,
      splitText: true,
      contentMarkdown: true,
      contentHtml: true,
      editorNote: true,
      sourceType: true,
      status: true,
      targetWord: {
        select: {
          id: true,
          word: true,
          slug: true,
          partOfSpeech: true,
          meaningCn: true,
          shortMeaningCn: true,
          meaningEn: true,
          levelTags: true
        }
      }
    }
  });
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));

  return reportItems
    .map((missingItem) => {
      const entry = entryById.get(missingItem.entryId);
      if (!entry) return null;
      if (!force && hasRenderedImage(entry)) return null;
      return {
        entry,
        missingItem,
        prompt: buildImagePrompt(entry, missingItem)
      } satisfies Target;
    })
    .filter((item): item is Target => item !== null)
    .sort((left, right) => left.entry.targetWord.word.localeCompare(right.entry.targetWord.word));
}

async function loadLocalImageManifest(manifestPath: string): Promise<LocalImageManifestItem[]> {
  const resolvedManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(resolvedManifestPath);
  const parsed = JSON.parse(await fsp.readFile(resolvedManifestPath, "utf8")) as {
    outputs?: Array<{
      index?: number;
      word?: string;
      id?: string;
      entryId?: string;
      file?: string;
      imagePath?: string;
    }>;
  };
  const outputs = parsed.outputs ?? [];
  const items = outputs.map((output) => {
    const entryId = output.entryId ?? output.id;
    const imagePath = output.imagePath ?? output.file;
    if (!output.word || !entryId || !imagePath) {
      throw new Error(`Invalid local image manifest item: ${JSON.stringify(output)}`);
    }
    return {
      index: output.index,
      word: output.word,
      entryId,
      imagePath: path.isAbsolute(imagePath) ? imagePath : path.resolve(manifestDir, imagePath)
    };
  });
  if (!items.length) throw new Error(`Local image manifest has no outputs: ${manifestPath}`);
  return items;
}

function orderTargetsByLocalManifest(targets: Target[], manifest: LocalImageManifestItem[]) {
  const targetByEntryId = new Map(targets.map((target) => [target.entry.id, target]));
  return manifest.flatMap((item) => {
    const target = targetByEntryId.get(item.entryId);
    return target ? [target] : [];
  });
}

function buildImagePrompt(entry: Entry, item: MissingImageItem) {
  const word = entry.targetWord.word;
  const meaning = [entry.targetWord.partOfSpeech, entry.targetWord.meaningCn]
    .filter(Boolean)
    .join(" ");
  const focus = cueContext(entry.contentMarkdown, item.cueMatches[0] ?? "");
  const fullCard = clipText(normalizePromptText(entry.contentMarkdown), 3000);

  return `Use case: scientific-educational
Asset type: inline mnemonic-card illustration for a Chinese English-learning website
Primary request: Create one image that tightly visualizes the specific mnemonic scene described in the card. Do not make a generic dictionary picture for the word.

Target word: ${word}
Meaning: ${meaning}
Split: ${entry.splitText ?? ""}
Image cue matched in card: ${item.cueMatches.join(" / ")}

Most important card passage:
"""
${focus}
"""

Full card text for context:
"""
${fullCard}
"""

Required visual content:
- Follow the concrete objects, location, action, comparison, spatial position, red circle, arrow, or diagram described by the passage.
- If a brand, celebrity, logo, exam page, or copyrighted UI is mentioned, depict a generic recognizable substitute with no logo or readable brand text.
- If the passage describes a position, direction, contrast, or "shown in the image", make that relationship visually obvious.
- Use only details that are in the card or needed to clarify the mnemonic. Avoid unrelated decorative objects.

Style and composition:
- Realistic cinematic mnemonic image, suitable for a small study card.
- Square composition, centered subject, generous padding, high contrast, natural colors.
- Exaggerate emotion, facial expression, body language, scale, lighting, and action when it strengthens the memory hook.
- Prefer real-world props, believable environments, dramatic contrast, and immediate visual storytelling.
- No readable text, no English letters, no Chinese characters, no labels, no watermark, no UI screenshot, no logo.`;
}

async function generateImageWithRetries(prompt: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await requestImage(prompt);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) await sleep(2_000 * attempt * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function requestImage(prompt: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${imageBaseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${imageApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: imageModel,
        prompt,
        n: 1,
        size: imageSize,
        quality: imageQuality,
        output_format: outputFormat
      })
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Image request failed: ${response.status} ${text.slice(0, 1200)}`);
    }
    const payload = JSON.parse(text) as { data?: Array<{ b64_json?: string }> };
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64) throw new Error(`Image response has no b64_json: ${text.slice(0, 500)}`);
    return Buffer.from(b64, "base64");
  } finally {
    clearTimeout(timeout);
  }
}

async function saveGeneratedImage(target: Target, bytes: Buffer) {
  const filename = `${safeFilename(target.entry.targetWord.slug || target.entry.targetWord.word)}-${target.entry.id.slice(0, 8)}-${Date.now()}.${outputFormat}`;
  const imagePath = path.join(uploadDir, filename);
  await fsp.writeFile(imagePath, bytes);
  const metadata = await sharp(imagePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Generated image is unreadable: ${imagePath}`);
  }
  return {
    imagePath,
    imageUrl: `${uploadUrlPrefix}/${filename}`,
    width: metadata.width,
    height: metadata.height
  };
}

async function applySavedImageToEntry({
  target,
  saved,
  actor,
  backupPath,
  reportPath,
  source
}: {
  target: Target;
  saved: { imagePath: string; imageUrl: string; width: number; height: number };
  actor: { id: string } | null;
  backupPath: string | null;
  reportPath: string;
  source: "built-in-imagegen" | "image-api";
}) {
  if (!actor) throw new Error("Missing actor");
  const nextContentMarkdown = insertImageMarkdown({
    markdown: target.entry.contentMarkdown,
    imageMarkdown: `![${escapeMarkdownAlt(target.entry.targetWord.word)} 助记图](${saved.imageUrl})`,
    cueMatches: target.missingItem.cueMatches
  });
  const contentHtml = await renderMnemonicMarkdown(nextContentMarkdown);
  const plainText = markdownToPlainText(
    [target.entry.splitText ? `划分：${target.entry.splitText}` : "", nextContentMarkdown]
      .filter(Boolean)
      .join("\n\n")
  );

  await prisma.$transaction(async (tx) => {
    await tx.mnemonicEntryVersion.create({
      data: {
        mnemonicEntryId: target.entry.id,
        contentMarkdown: target.entry.contentMarkdown,
        splitText: target.entry.splitText,
        title: target.entry.title,
        editorId: actor.id
      }
    });
    await tx.mnemonicEntry.update({
      where: { id: target.entry.id },
      data: {
        contentMarkdown: nextContentMarkdown,
        contentHtml,
        plainText,
        editorNote: appendEditorNote(target.entry.editorNote, marker)
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "MNEMONIC_GENERATED_IMAGE_INSERT",
        entityType: "MnemonicEntry",
        entityId: target.entry.id,
        metadataJson: {
          marker,
          source,
          word: target.entry.targetWord.word,
          imageModel: source === "image-api" ? imageModel : "built-in-imagegen",
          imageSize,
          imageQuality,
          outputFormat,
          imageUrl: saved.imageUrl,
          imagePath: saved.imagePath,
          prompt: target.prompt,
          sourceReportPath: missingReportPath,
          backupPath,
          reportPath
        } satisfies Prisma.InputJsonObject
      }
    });
  });
}

function insertImageMarkdown({
  markdown,
  imageMarkdown,
  cueMatches
}: {
  markdown: string;
  imageMarkdown: string;
  cueMatches: string[];
}) {
  const normalized = markdown.replace(/\r\n?/gu, "\n").trimEnd();
  const existingImage = hasRenderedMarkdownImage(normalized);
  if (existingImage) return normalized;

  const cueIndexes = cueMatches.map((cue) => normalized.indexOf(cue)).filter((index) => index >= 0);
  const regexCueIndex = normalized.search(cuePattern);
  if (regexCueIndex >= 0) cueIndexes.push(regexCueIndex);
  const cueIndex = cueIndexes.length ? Math.min(...cueIndexes) : -1;

  if (cueIndex >= 0) {
    const afterCue = normalized.slice(cueIndex);
    const paragraphBreak = afterCue.search(/\n{2,}/u);
    const lineBreak = afterCue.indexOf("\n");
    const relativeInsertAt =
      paragraphBreak >= 0 ? paragraphBreak : lineBreak >= 0 ? lineBreak : afterCue.length;
    const insertAt = cueIndex + relativeInsertAt;
    return [
      normalized.slice(0, insertAt).trimEnd(),
      imageMarkdown,
      normalized.slice(insertAt).trimStart()
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  const relatedWordsIndex = normalized.search(/\n\s*相关单词\s*[:：]/u);
  if (relatedWordsIndex >= 0) {
    return [
      normalized.slice(0, relatedWordsIndex).trimEnd(),
      imageMarkdown,
      normalized.slice(relatedWordsIndex).trimStart()
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }

  return `${normalized}\n\n${imageMarkdown}`.trim();
}

function cueContext(markdown: string, cue: string) {
  const normalized = normalizePromptText(markdown);
  const index = cue ? normalized.indexOf(cue) : -1;
  if (index < 0) return clipText(normalized, 1200);
  const start = Math.max(0, index - 500);
  const end = Math.min(normalized.length, index + cue.length + 900);
  return clipText(
    `${start > 0 ? "..." : ""}${normalized.slice(start, end)}${end < normalized.length ? "..." : ""}`,
    1500
  );
}

function normalizePromptText(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(
      /\[\[word:([^\]|]+)(?:\|([^\]]+))?\]\]/gi,
      (_match, target: string, label: string | undefined) => label || target
    )
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function clipText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function hasRenderedImage(entry: Entry) {
  return (
    renderedImagePattern.test(entry.contentMarkdown) || renderedImagePattern.test(entry.contentHtml)
  );
}

function hasRenderedMarkdownImage(markdown: string) {
  return /!\[[^\]]*\]\([^)]+\)|<img\b|<figure\b|data:image\//i.test(markdown);
}

async function resolveActor() {
  const actor =
    (await prisma.user.findFirst({
      where: { email: actorEmail, status: "ACTIVE" },
      select: { id: true, email: true, username: true }
    })) ??
    (await prisma.user.findFirst({
      where: { OR: [{ role: UserRole.ADMIN }, { role: UserRole.EDITOR }], status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true, email: true, username: true }
    }));
  if (!actor) throw new Error("找不到可用于批量更新的管理员/编辑账号。");
  return actor;
}

async function writeBackup(targets: Target[]) {
  await fsp.mkdir(backupDir, { recursive: true });
  const entries = await prisma.mnemonicEntry.findMany({
    where: { id: { in: targets.map((target) => target.entry.id) } },
    include: {
      targetWord: true,
      versions: true,
      links: true,
      userCardOrders: true
    },
    orderBy: [{ targetWord: { word: "asc" } }]
  });
  const backupPath = path.join(backupDir, `mnemonic-before-generated-images-${Date.now()}.json`);
  await fsp.writeFile(
    backupPath,
    JSON.stringify(
      {
        marker,
        createdAt: new Date().toISOString(),
        sourceReportPath: missingReportPath,
        entries
      },
      null,
      2
    )
  );
  return backupPath;
}

async function writeReports(report: RunReport, reportPath: string, latestReportPath: string) {
  report.updatedAt = new Date().toISOString();
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2));
  await fsp.writeFile(latestReportPath, JSON.stringify(report, null, 2));
}

function readCheckpoint(filePath: string): Checkpoint {
  if (!fs.existsSync(filePath)) return { doneEntryIds: [] };
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<Checkpoint>;
  return {
    doneEntryIds: Array.isArray(parsed.doneEntryIds) ? parsed.doneEntryIds : []
  };
}

async function writeCheckpoint(filePath: string, checkpoint: Checkpoint) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(checkpoint, null, 2));
}

function printPromptPreview(targets: Target[]) {
  for (const target of targets.slice(0, 5)) {
    console.log(`\n--- ${target.entry.targetWord.word} (${target.entry.id}) ---`);
    console.log(target.prompt.slice(0, 1800));
  }
  if (targets.length > 5) console.log(`\n... 另有 ${targets.length - 5} 张 prompt 已写入报告。`);
}

function appendEditorNote(existing: string | null, note: string) {
  const normalized = existing?.trim();
  if (!normalized) return note;
  if (normalized.includes(note)) return normalized;
  return `${normalized}\n${note}`;
}

function escapeMarkdownAlt(value: string) {
  return value.replace(/[[\]]/gu, "");
}

function safeFilename(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mnemonic-image"
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = unquoteEnvValue(match[2].trim());
    if (value) process.env[key] = value;
  }
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function numberArg(name: string) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function stringArg(name: string) {
  const raw = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return raw ? raw.slice(name.length + 1) : null;
}

function enumArg<T extends string>(name: string, values: readonly T[], fallback: T) {
  const raw = stringArg(name);
  return raw && values.includes(raw as T) ? (raw as T) : fallback;
}

function firstFilled(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
