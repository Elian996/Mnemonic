import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { AgentImageInput, AgentImportPayload } from "@/lib/import-drafts/types";

const execFileAsync = promisify(execFile);

type ExtractImageInput = {
  imageBytes: Buffer;
  filename: string;
  mimeType: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export async function extractImageImportPayload({ imageBytes, filename, mimeType, apiKey: inputApiKey, baseUrl: inputBaseUrl, model: inputModel }: ExtractImageInput): Promise<AgentImportPayload> {
  const apiKey = inputApiKey || process.env.AI_AGENT_API_KEY || process.env.AI_AUTOFILL_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return extractLocalImageImportPayload({ imageBytes, filename, mimeType });
  }

  const baseUrl = inputBaseUrl || process.env.AI_AGENT_BASE_URL || process.env.AI_AUTOFILL_BASE_URL || "https://api.openai.com/v1";
  const model = inputModel || process.env.AI_AGENT_MODEL || process.env.AI_AUTOFILL_MODEL || "gpt-4.1-mini";
  if (isTextOnlyProvider(baseUrl, model)) {
    return extractTextModelImageImportPayload({ imageBytes, filename, mimeType, apiKey, baseUrl, model });
  }

  const imageBase64 = imageBytes.toString("base64");
  const metadata = await sharp(imageBytes).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  const extraction = await callVisionModel({ baseUrl, apiKey, model, mimeType, imageBase64 });
  const cropWarnings: string[] = [];
  const embeddedImages = await cropEmbeddedImages({
    imageBytes,
    imageWidth,
    imageHeight,
    items: Array.isArray(extraction.embeddedImages)
      ? (extraction.embeddedImages as Array<{ filename?: string; bbox?: { x?: number; y?: number; width?: number; height?: number } }>)
      : [],
    warnings: cropWarnings
  });
  const relatedWords = normalizeRelatedWords(extraction.relatedWords, extraction.links);
  const links = relatedWords.length
    ? relatedWords.map((value) => ({ type: "word", value }))
    : Array.isArray(extraction.links)
      ? extraction.links
      : [];
  const warnings = [
    ...toStringArray(extraction.warnings),
    ...cropWarnings,
    ...(Array.isArray(extraction.embeddedImages) && extraction.embeddedImages.length && !embeddedImages.length
      ? ["AI 标出了内嵌图片区域，但自动裁剪失败。已保留原始截图，可在预览页手动使用原图。"]
      : [])
  ];

  return {
    source: "website-image-import",
    word: String(extraction.word ?? ""),
    phonetic: String(extraction.phonetic ?? ""),
    phoneticUk: String(extraction.phoneticUk ?? ""),
    phoneticUs: String(extraction.phoneticUs ?? ""),
    partOfSpeech: String(extraction.partOfSpeech ?? ""),
    meaningCn: String(extraction.meaningCn ?? ""),
    meaningEn: String(extraction.meaningEn ?? ""),
    shortMeaningCn: String(extraction.shortMeaningCn ?? ""),
    difficulty: Number(extraction.difficulty || 3),
    splitText: String(extraction.splitText ?? ""),
    title: String(extraction.title ?? ""),
    mnemonicMarkdown: String(extraction.mnemonicMarkdown ?? ""),
    exampleSentence: String(extraction.exampleSentence ?? ""),
    exampleTranslation: String(extraction.exampleTranslation ?? ""),
    relatedWords,
    links,
    confidence: Number.isFinite(Number(extraction.confidence)) ? Number(extraction.confidence) : undefined,
    warnings,
    rawText: String(extraction.rawText ?? ""),
    images: [
      {
        kind: "original",
        filename,
        mimeType,
        base64: imageBase64
      },
      ...embeddedImages
    ]
  };
}

export async function extractBatchImageImportPayloads({
  imageBytes,
  mimeType,
  apiKey: inputApiKey,
  baseUrl: inputBaseUrl,
  model: inputModel
}: ExtractImageInput): Promise<AgentImportPayload[]> {
  const lines = await runMacVisionOcr(imageBytes, mimeType);
  const rawText = lines.map((line) => line.text).join("\n");
  const fallback = parseLocalBatchOcrLines(lines);
  const apiKey = inputApiKey || process.env.AI_AGENT_API_KEY || process.env.AI_AUTOFILL_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const baseUrl = inputBaseUrl || process.env.AI_AGENT_BASE_URL || process.env.AI_AUTOFILL_BASE_URL || "https://api.openai.com/v1";
  const model = inputModel || process.env.AI_AGENT_MODEL || process.env.AI_AUTOFILL_MODEL || "gpt-4.1-mini";
  const extraction: AgentImportPayload[] = await callBatchOcrStructuringModel({
    baseUrl,
    apiKey,
    model,
    rawText,
    ocrLines: lines
  }).catch((error) =>
    fallback.map((item) => ({
      ...item,
      warnings: [`批量结构化失败，已使用本机规则兜底：${error instanceof Error ? error.message : "未知错误"}`]
    }))
  );

  return extraction.map((item: AgentImportPayload, index: number) => ({
    ...item,
    source: "website-batch-image-import",
    rawText: item.rawText || rawText,
    confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : fallback[index]?.confidence ?? 0.65,
    warnings: [
      "长截图批量识别结果请核对。确认保存后会追加为该单词的新记忆卡。",
      ...toStringArray(item.warnings)
    ]
  }));
}

async function extractTextModelImageImportPayload({
  imageBytes,
  filename,
  mimeType,
  apiKey,
  baseUrl,
  model
}: Pick<ExtractImageInput, "imageBytes" | "filename" | "mimeType"> & {
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<AgentImportPayload> {
  const imageBase64 = imageBytes.toString("base64");
  const metadata = await sharp(imageBytes).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  const lines = await runMacVisionOcr(imageBytes, mimeType);
  const fallback = parseLocalOcrLines(lines);
  const extraction = await callOcrStructuringModel({
    baseUrl,
    apiKey,
    model,
    rawText: lines.map((line) => line.text).join("\n"),
    ocrLines: lines
  }).catch((error) => ({
    ...fallback,
    warnings: [`DeepSeek 结构化失败，已使用本机规则兜底：${error instanceof Error ? error.message : "未知错误"}`]
  }));
  const cropWarnings: string[] = [];
  const embeddedImages = await cropEmbeddedImages({
    imageBytes,
    imageWidth,
    imageHeight,
    items: guessEmbeddedImageBoxes(lines, imageWidth, imageHeight, filename),
    warnings: cropWarnings
  });
  const relatedWords = normalizeRelatedWords(extraction.relatedWords, extraction.links);
  const links = relatedWords.map((value) => ({ type: "word", value }));
  const warnings = [
    "已使用本机 OCR + DeepSeek 文本结构化。请在预览页核对 OCR 可能误识别的音标、中文和例句。",
    ...toStringArray(extraction.warnings),
    ...(embeddedImages.length ? [] : ["未能稳定定位内嵌图片区域，已保留原始截图，可在预览页手动处理。"]),
    ...cropWarnings
  ];

  return {
    source: "website-deepseek-ocr",
    word: String(extraction.word ?? fallback.word),
    phonetic: String(extraction.phonetic ?? fallback.phonetic),
    phoneticUk: String(extraction.phoneticUk ?? extraction.phonetic ?? fallback.phonetic),
    phoneticUs: String(extraction.phoneticUs ?? ""),
    partOfSpeech: String(extraction.partOfSpeech ?? fallback.partOfSpeech),
    meaningCn: String(extraction.meaningCn ?? fallback.meaningCn),
    meaningEn: String(extraction.meaningEn ?? ""),
    shortMeaningCn: String(extraction.shortMeaningCn ?? extraction.meaningCn ?? fallback.meaningCn).split(/[；;，,]/)[0] ?? "",
    difficulty: Number(extraction.difficulty || 3),
    splitText: String(extraction.splitText ?? fallback.splitText),
    title: String(extraction.title ?? `${String(extraction.word ?? fallback.word)} 记忆卡片`),
    mnemonicMarkdown: String(extraction.mnemonicMarkdown ?? fallback.mnemonicMarkdown),
    exampleSentence: String(extraction.exampleSentence ?? fallback.exampleSentence),
    exampleTranslation: String(extraction.exampleTranslation ?? fallback.exampleTranslation),
    relatedWords,
    links,
    confidence: Number.isFinite(Number(extraction.confidence)) ? Number(extraction.confidence) : fallback.confidence,
    warnings,
    rawText: lines.map((line) => line.text).join("\n"),
    images: [
      {
        kind: "original",
        filename,
        mimeType,
        base64: imageBase64
      },
      ...embeddedImages
    ]
  };
}

async function extractLocalImageImportPayload({ imageBytes, filename, mimeType }: Pick<ExtractImageInput, "imageBytes" | "filename" | "mimeType">): Promise<AgentImportPayload> {
  const imageBase64 = imageBytes.toString("base64");
  const metadata = await sharp(imageBytes).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  const lines = await runMacVisionOcr(imageBytes, mimeType);
  const parsed = parseLocalOcrLines(lines);
  const cropWarnings: string[] = [];
  const embeddedImages = await cropEmbeddedImages({
    imageBytes,
    imageWidth,
    imageHeight,
    items: guessEmbeddedImageBoxes(lines, imageWidth, imageHeight, filename),
    warnings: cropWarnings
  });

  return {
    source: "website-local-ocr",
    word: parsed.word,
    phonetic: parsed.phonetic,
    phoneticUk: parsed.phonetic,
    phoneticUs: "",
    partOfSpeech: parsed.partOfSpeech,
    meaningCn: parsed.meaningCn,
    shortMeaningCn: parsed.meaningCn.split(/[；;，,]/)[0] ?? parsed.meaningCn,
    difficulty: 3,
    splitText: parsed.splitText,
    title: parsed.word ? `${parsed.word} 记忆卡片` : "本机 OCR 导入草稿",
    mnemonicMarkdown: parsed.mnemonicMarkdown,
    exampleSentence: parsed.exampleSentence,
    exampleTranslation: parsed.exampleTranslation,
    relatedWords: parsed.relatedWords,
    links: parsed.relatedWords.map((value) => ({ type: "word", value })),
    confidence: parsed.confidence,
    warnings: [
      "未配置 AI，已使用本机 OCR 兜底。它只能按固定截图格式提取文字，记忆方法和相关单词请在预览页核对。",
      ...(embeddedImages.length ? [] : ["未能稳定定位内嵌图片区域，已保留原始截图，可在预览页手动处理。"]),
      ...cropWarnings
    ],
    rawText: lines.map((line) => line.text).join("\n"),
    images: [
      {
        kind: "original",
        filename,
        mimeType,
        base64: imageBase64
      },
      ...embeddedImages
    ]
  };
}

async function callVisionModel({
  baseUrl,
  apiKey,
  model,
  mimeType,
  imageBase64
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  mimeType: string;
  imageBase64: string;
}): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你是英语记忆卡片 OCR 与结构化 Agent。只输出 JSON，不要 Markdown 包裹。必须忠实提取截图内容，不要编造。若不确定，字段留空。"
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请从图片中提取记忆卡片，输出 JSON：
{
  "word": "英文单词小写",
  "phonetic": "音标",
  "phoneticUk": "英音音标，可空",
  "phoneticUs": "美音音标，可空",
  "partOfSpeech": "词性，例如 n.",
  "meaningCn": "完整中文释义",
  "shortMeaningCn": "短释义",
  "splitText": "划分，例如 cy | lin | der",
  "title": "标题",
  "mnemonicMarkdown": "记忆方法正文，整理为：划分、带你背、图片占位、例句、相关单词。相关单词请用 [[word:cycle]] 格式。",
  "exampleSentence": "英文例句",
  "exampleTranslation": "中文翻译",
  "relatedWords": ["cycle"],
  "links": [{"type":"word","value":"cycle"}],
  "embeddedImages": [
    {"filename":"illustration.png","bbox":{"x":0.1,"y":0.4,"width":0.8,"height":0.3}}
  ],
  "confidence": 0.92,
  "warnings": ["不确定的内容"],
  "rawText": "OCR 原始文字"
}

bbox 使用 0-1 归一化坐标，定位截图中需要保留到新卡片里的内嵌图片或示意图。
请把底部相关单词转成普通英文单词数组，并在 mnemonicMarkdown 的“相关单词”部分写成每行一个 [[word:xxx]]。不要编造截图外的内容。`
            },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` }
            }
          ]
        }
      ]
    })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(`图片识别失败：${response.status} ${JSON.stringify(result)}`);
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 图片识别没有返回内容");
  return JSON.parse(extractJsonObject(content));
}

async function callOcrStructuringModel({
  baseUrl,
  apiKey,
  model,
  rawText,
  ocrLines
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  rawText: string;
  ocrLines: OcrLine[];
}) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你的工作是把英语记忆卡片截图的 OCR 文本整理成网站可保存的结构化 JSON。目标单词的音标、词性、中文释义以后会以数据库为准，你重点只提取“划分”“带你背”“例句”“相关单词”。你必须忠实依据 OCR 文本，不要编造截图中没有的信息；遇到 OCR 误字要尽量按上下文修正，但不确定就写入 warnings。只输出 JSON。"
        },
        {
          role: "user",
          content: `请把下面 OCR 结果整理成导入草稿 JSON。

目标字段：
{
  "word": "英文单词小写",
  "phonetic": "音标，保留 / /",
  "phoneticUk": "英音音标，可空",
  "phoneticUs": "美音音标，可空",
  "partOfSpeech": "词性，例如 n.",
  "meaningCn": "完整中文释义",
  "shortMeaningCn": "短释义",
  "splitText": "划分，例如 pati | o",
  "title": "标题",
  "mnemonicMarkdown": "按 划分、带你背、例句、相关单词 的顺序整理。相关单词每行 [[word:xxx]]。",
  "exampleSentence": "英文例句",
  "exampleTranslation": "中文例句翻译",
  "relatedWords": ["party"],
  "links": [{"type":"word","value":"party"}],
  "confidence": 0.75,
  "warnings": ["需要用户核对的点"]
}

格式要求：
- 相关单词必须转成 [[word:xxx]]，不要生成复杂 UI。
- 只有 OCR 里真的出现“相关单词”、链接图标、或“(N个)”之后的词卡时，才填写 relatedWords；不要把例句中的普通英文单词当相关单词。
- mnemonicMarkdown 尽量保持中文“带你背”的原意。
- 不固定格式的卡片也要处理：如果没有“带你背”标题，但 OCR 中有谐音、联想、词根词缀、拆分说明、图片说明等记忆文字，请把这些文字放进 mnemonicMarkdown 的“带你背：”下面；缺失的例句、翻译、相关单词保持空值。
- 如果 OCR 把“划分”“例句”识别成 #]5、15J、#J 等乱码，请结合上下文修正标题。
- 不要重写或新编记忆法；OCR 里有几行就整理几行，保持原意和顺序。
- 不要把词头、音标、词性释义重复塞进“带你背”；词头信息会使用数据库已有数据。
- 如果看不到某字段，留空字符串或空数组。

OCR 原文：
${rawText}

OCR 行坐标 JSON：
${JSON.stringify(ocrLines.slice(0, 80))}`
        }
      ]
    })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(`OCR 结构化失败：${response.status} ${JSON.stringify(result)}`);
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("OCR 结构化模型没有返回内容");
  return JSON.parse(extractJsonObject(content));
}

async function callBatchOcrStructuringModel({
  baseUrl,
  apiKey,
  model,
  rawText,
  ocrLines
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  rawText: string;
  ocrLines: OcrLine[];
}) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "你的工作是把一张包含多张英语单词记忆卡的长截图 OCR 文本拆成多个可导入卡片 JSON。目标单词的音标、词性、中文释义以后会以数据库为准，你重点提取划分、带你背、例句、相关单词。只输出 JSON，不要编造。"
        },
        {
          role: "user",
          content: `请把下面 OCR 结果按单词拆成数组，输出 JSON：
{
  "cards": [
    {
      "word": "firm",
      "phonetic": "/fɜːm/",
      "partOfSpeech": "adj.",
      "meaningCn": "坚定的；公司",
      "splitText": "fir | m",
      "title": "firm 记忆卡片",
      "mnemonicMarkdown": "带你背：\\n...\\n\\n例句：\\n英文例句\\n中文翻译",
      "exampleSentence": "英文例句，可空",
      "exampleTranslation": "中文翻译，可空",
      "relatedWords": ["fire"],
      "links": [{"type":"word","value":"fire"}],
      "confidence": 0.75,
      "warnings": []
    }
  ]
}

拆分规则：
- 每张卡通常以单独一行英文单词开始，后面跟音标、释义、带你背/例句/关联单词。
- 如果没有“带你背”标题，但有谐音、联想、词根词缀、拆分说明，也放进 mnemonicMarkdown 的“带你背：”下面。
- 例句只放在 mnemonicMarkdown 的“例句：”部分，并填 exampleSentence/exampleTranslation；没有就留空。
- 相关单词必须是截图里明确出现的关联词，转为 relatedWords，不要把例句普通单词当相关词。
- 不要把 Part 标题、水印、页眉页脚当单词卡。

OCR 原文：
${rawText}

OCR 行坐标 JSON：
${JSON.stringify(ocrLines.slice(0, 180))}`
        }
      ]
    })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(`批量 OCR 结构化失败：${response.status} ${JSON.stringify(result)}`);
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("批量 OCR 结构化模型没有返回内容");
  const parsed = JSON.parse(extractJsonObject(content));
  const cards: Array<Record<string, unknown>> = Array.isArray(parsed.cards) ? parsed.cards : [];
  return cards
    .map((card) => {
      const relatedWords = normalizeRelatedWords(card.relatedWords, card.links);
      const word = String(card.word ?? "").trim().toLowerCase();
      return {
        source: "website-batch-image-import",
        word,
        phonetic: String(card.phonetic ?? ""),
        phoneticUk: String(card.phoneticUk ?? card.phonetic ?? ""),
        phoneticUs: String(card.phoneticUs ?? ""),
        partOfSpeech: String(card.partOfSpeech ?? ""),
        meaningCn: String(card.meaningCn ?? ""),
        meaningEn: String(card.meaningEn ?? ""),
        shortMeaningCn: String(card.shortMeaningCn ?? card.meaningCn ?? "").split(/[；;，,]/)[0] ?? "",
        difficulty: Number(card.difficulty || 3),
        splitText: String(card.splitText ?? ""),
        title: String(card.title ?? `${word} 记忆卡片`),
        mnemonicMarkdown: String(card.mnemonicMarkdown ?? ""),
        exampleSentence: String(card.exampleSentence ?? ""),
        exampleTranslation: String(card.exampleTranslation ?? ""),
        relatedWords,
        links: relatedWords.map((value) => ({ type: "word", value })),
        confidence: Number(card.confidence || 0.7),
        warnings: toStringArray(card.warnings),
        rawText: String(card.rawText ?? "")
      };
    })
    .filter((card) => /^[a-z][a-z'-]*$/i.test(card.word));
}

type OcrLine = {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

async function runMacVisionOcr(imageBytes: Buffer, mimeType: string): Promise<OcrLine[]> {
  const extension = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mnemonic-ocr-"));
  const imagePath = path.join(tmpDir, `input.${extension}`);
  const scriptPath = path.join(process.cwd(), "scripts", "macos-vision-ocr.swift");

  try {
    await fs.writeFile(imagePath, imageBytes);
    const { stdout } = await execFileAsync("/usr/bin/swift", [scriptPath, imagePath], { maxBuffer: 1024 * 1024 * 8 });
    const lines = JSON.parse(stdout) as OcrLine[];
    return lines
      .filter((line) => line.text.trim())
      .sort((a, b) => {
        const topA = 1 - a.y - a.height;
        const topB = 1 - b.y - b.height;
        return topA === topB ? a.x - b.x : topA - topB;
      });
  } catch (error) {
    throw new Error(`本机 OCR 失败：${error instanceof Error ? error.message : "无法调用 macOS Vision"}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function parseLocalOcrLines(lines: OcrLine[]) {
  const texts = lines.map((line) => cleanOcrText(line.text)).filter(Boolean);
  const text = texts.join("\n");
  const firstWordLine = texts.find((line) => /^[a-z][a-z'-]+\b/i.test(line));
  const word = firstWordLine?.match(/^([a-z][a-z'-]+)\b/i)?.[1]?.toLowerCase() ?? "";
  const phonetic = text.match(/\/[^/\n]{2,40}\//)?.[0] ?? "";
  const meaningLine = texts.find((line) => /^[a-z]{1,6}\.\s*[\u4e00-\u9fff]/i.test(line));
  const partOfSpeech = meaningLine?.match(/^([a-z]{1,6}\.)/i)?.[1] ?? "";
  const meaningCn = meaningLine?.replace(/^[a-z]{1,6}\.\s*/i, "").trim() ?? "";
  const splitText = texts.find((line) => line.includes("划分"))?.replace(/^.*?划分[:：]\s*/u, "").replace(/\s*\|\s*/g, " | ").trim() ?? "";
  const example = parseExample(texts);
  const relatedWords = parseLocalRelatedWords(texts, word);
  const mnemonicMarkdown = buildLocalMnemonicMarkdown(texts, word, splitText, example.exampleSentence, relatedWords);
  const confidence = lines.length ? average(lines.map((line) => Number(line.confidence) || 0)) : 0.35;

  return {
    word,
    phonetic,
    partOfSpeech,
    meaningCn,
    splitText,
    mnemonicMarkdown,
    exampleSentence: example.exampleSentence,
    exampleTranslation: example.exampleTranslation,
    relatedWords,
    confidence: clampConfidence(confidence)
  };
}

function parseLocalBatchOcrLines(lines: OcrLine[]): AgentImportPayload[] {
  const texts = lines.map((line) => cleanOcrText(line.text)).filter(Boolean);
  const starts = texts
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^[a-z][a-z'-]{1,24}$/i.test(line) && !["part"].includes(line.toLowerCase()));
  const cards: AgentImportPayload[] = [];

  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1]?.index ?? texts.length;
    const section = texts.slice(start.index, end);
    if (section.length < 3) continue;
    const word = start.line.toLowerCase();
    const phonetic = section.join("\n").match(/\/[^/\n]{2,40}\//)?.[0] ?? "";
    const meaningLine = section.find((line) => /释义[:：]/u.test(line) || /^[a-z]{1,6}\.\s*[\u4e00-\u9fff]/i.test(line));
    const meaningCn = meaningLine
      ?.replace(/^释义[:：]\s*/u, "")
      .replace(/^[a-z]{1,6}\.\s*/i, "")
      .trim() ?? "";
    const splitText = section.find((line) => /划分[:：]/u.test(line))?.replace(/^.*?划分[:：]\s*/u, "").trim() ?? "";
    const example = parseExample(section);
    const relatedWords = parseLocalRelatedWords(section, word);
    cards.push({
      source: "website-batch-local-ocr",
      word,
      phonetic,
      phoneticUk: phonetic,
      partOfSpeech: meaningLine?.match(/^([a-z]{1,6}\.)/i)?.[1] ?? "",
      meaningCn,
      shortMeaningCn: meaningCn.split(/[；;，,]/)[0] ?? meaningCn,
      splitText,
      title: `${word} 记忆卡片`,
      mnemonicMarkdown: buildLocalMnemonicMarkdown(section, word, splitText, example.exampleSentence, relatedWords),
      exampleSentence: example.exampleSentence,
      exampleTranslation: example.exampleTranslation,
      relatedWords,
      links: relatedWords.map((value) => ({ type: "word", value })),
      confidence: 0.45,
      rawText: section.join("\n"),
      warnings: ["本机规则批量拆分结果请重点核对。"]
    });
  }

  return cards;
}

function buildLocalMnemonicMarkdown(texts: string[], currentWord: string, splitText: string, exampleSentence: string, relatedWords: string[]) {
  const bodyLines = texts.filter((line) => {
    if (!line) return false;
    if (currentWord && line.toLowerCase() === currentWord) return false;
    if (/^[a-z][a-z'-]+\b.*\/[^/]+\//i.test(line)) return false;
    if (/^[a-z]{1,6}\.\s*[\u4e00-\u9fff]/i.test(line)) return false;
    if (/^带你背$/u.test(line)) return false;
    if (line.includes("划分")) return false;
    if (line.includes("例句")) return false;
    if (exampleSentence && line.includes(exampleSentence)) return false;
    if (relatedWords.some((word) => new RegExp(`^${escapeRegExp(word)}\\b`, "i").test(line))) return false;
    if (/^\(?\d+\s*个\)?$/u.test(line) || /\(\d+\s*个\)/u.test(line)) return false;
    return true;
  });
  const uniqueBody = dedupeAdjacent(bodyLines).join("\n");
  return [`划分：${splitText}`, "", "带你背：", uniqueBody].filter((line, index) => index < 3 || line.trim()).join("\n");
}

function parseExample(texts: string[]) {
  const exampleIndex = texts.findIndex((line) => line.includes("例句"));
  if (exampleIndex === -1) return { exampleSentence: "", exampleTranslation: "" };
  const exampleLine = texts[exampleIndex] ?? "";
  const inlineSentence = exampleLine.replace(/^.*?例句[:：]?\s*/u, "").trim();
  const exampleSentence = /[A-Za-z]/.test(inlineSentence)
    ? inlineSentence
    : texts.slice(exampleIndex + 1).find((line) => /[A-Za-z]/.test(line) && !/^[a-z][a-z'-]+\b.*\/[^/]+\//i.test(line)) ?? "";
  const sentenceIndex = texts.findIndex((line) => line === exampleSentence);
  const exampleTranslation = sentenceIndex >= 0
    ? texts.slice(sentenceIndex + 1).find((line) => /[\u4e00-\u9fff]/.test(line) && !line.includes("相关")) ?? ""
    : "";
  return { exampleSentence, exampleTranslation };
}

function parseLocalRelatedWords(texts: string[], currentWord: string) {
  const linkIndex = texts.findIndex((line) => /相关单词|链接|🔗|\(\d+\s*个\)/u.test(line));
  if (linkIndex === -1) return [];
  const candidates = texts.slice(linkIndex + 1)
    .map((line) => line.match(/^([a-z][a-z'-]+)\b/i)?.[1]?.toLowerCase() ?? "")
    .filter((word) => word && word !== currentWord);
  return Array.from(new Set(candidates));
}

function guessEmbeddedImageBoxes(lines: OcrLine[], imageWidth: number, imageHeight: number, filename: string) {
  if (!imageWidth || !imageHeight) return [];
  const positioned = lines
    .map((line) => ({
      text: cleanOcrText(line.text),
      top: (1 - line.y - line.height) * imageHeight,
      bottom: (1 - line.y) * imageHeight
    }))
    .filter((line) => line.bottom > imageHeight * 0.04 && line.top < imageHeight * 0.98)
    .sort((a, b) => a.top - b.top);
  if (!positioned.length) return [];

  const gaps: Array<{ top: number; bottom: number; score: number }> = [];
  const minGapHeight = Math.max(140, imageHeight * 0.16);
  const pad = Math.max(8, imageHeight * 0.008);

  for (let index = 0; index < positioned.length - 1; index += 1) {
    const current = positioned[index];
    const next = positioned[index + 1];
    const top = current.bottom + pad;
    const bottom = next.top - pad;
    const height = bottom - top;
    if (height < minGapHeight) continue;

    const nearImageCue = /图|图片|示意|如下|上面|下面/u.test(current.text) || /例句|相关单词|链接/u.test(next.text);
    gaps.push({ top, bottom, score: height * (nearImageCue ? 1.35 : 1) });
  }

  const lastLine = positioned[positioned.length - 1];
  const bottomGapTop = lastLine.bottom + pad;
  const bottomGapHeight = imageHeight - bottomGapTop - pad;
  if (bottomGapHeight >= minGapHeight && lastLine.top < imageHeight * 0.5) {
    gaps.push({ top: bottomGapTop, bottom: imageHeight - pad, score: bottomGapHeight * 1.1 });
  }

  const bestGap = gaps.sort((a, b) => b.score - a.score)[0];
  if (!bestGap || bestGap.bottom - bestGap.top < minGapHeight) return [];

  return [
    {
      filename: filename.replace(/\.[^.]+$/, "") + "-embedded.png",
      bbox: {
        x: 0.04,
        y: bestGap.top / imageHeight,
        width: 0.92,
        height: (bestGap.bottom - bestGap.top) / imageHeight
      }
    }
  ];
}

async function cropEmbeddedImages({
  imageBytes,
  imageWidth,
  imageHeight,
  items,
  warnings
}: {
  imageBytes: Buffer;
  imageWidth: number;
  imageHeight: number;
  items: Array<{ filename?: string; bbox?: { x?: number; y?: number; width?: number; height?: number } }>;
  warnings: string[];
}): Promise<AgentImageInput[]> {
  const cropped: AgentImageInput[] = [];
  for (const [index, item] of items.entries()) {
    const bbox = item.bbox;
    if (!bbox || !imageWidth || !imageHeight) continue;
    const left = clampPixel(Number(bbox.x ?? 0) * imageWidth, 0, imageWidth - 1);
    const top = clampPixel(Number(bbox.y ?? 0) * imageHeight, 0, imageHeight - 1);
    const width = clampPixel(Number(bbox.width ?? 0) * imageWidth, 1, imageWidth - left);
    const height = clampPixel(Number(bbox.height ?? 0) * imageHeight, 1, imageHeight - top);
    try {
      const bytes = await sharp(imageBytes).extract({ left, top, width, height }).png().toBuffer();
      cropped.push({
        kind: "embedded-illustration",
        filename: item.filename ?? `embedded-${index + 1}.png`,
        mimeType: "image/png",
        base64: bytes.toString("base64")
      });
    } catch {
      warnings.push(`第 ${index + 1} 张内嵌图片自动裁剪失败，已保留原始截图。`);
    }
  }
  return cropped;
}

function extractJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced ?? content).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}

function clampPixel(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeRelatedWords(value: unknown, links: unknown) {
  const fromRelated = toStringArray(value);
  const fromLinks = Array.isArray(links)
    ? links
        .map((link) => {
          if (!link || typeof link !== "object") return "";
          const item = link as { type?: unknown; value?: unknown };
          const type = String(item.type ?? "word").toLowerCase();
          return type === "word" ? String(item.value ?? "") : "";
        })
        .filter(Boolean)
    : [];
  return Array.from(new Set([...fromRelated, ...fromLinks].map((word) => word.trim().toLowerCase()).filter(Boolean)));
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function isTextOnlyProvider(baseUrl: string, model: string) {
  return baseUrl.toLowerCase().includes("deepseek") || model.toLowerCase().startsWith("deepseek");
}

function cleanOcrText(text: string) {
  return text.replace(/\s+/g, " ").replace(/[|｜]/g, "|").trim();
}

function dedupeAdjacent(lines: string[]) {
  const result: string[] = [];
  for (const line of lines) {
    if (line !== result[result.length - 1]) result.push(line);
  }
  return result;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampConfidence(value: number) {
  return Math.max(0.1, Math.min(0.9, value || 0.35));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
