#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const imagePath = process.argv[2];
const siteUrl = process.env.MNEMONIC_SITE_URL ?? "http://localhost:3000";
const apiKey = process.env.AI_AGENT_API_KEY || process.env.AI_AUTOFILL_API_KEY || process.env.OPENAI_API_KEY;
const baseUrl = process.env.AI_AGENT_BASE_URL || process.env.AI_AUTOFILL_BASE_URL || "https://api.openai.com/v1";
const model = process.env.AI_AGENT_MODEL || process.env.AI_AUTOFILL_MODEL || "gpt-4.1-mini";

if (!imagePath) {
  console.error("Usage: node agent/image-card-agent.mjs /path/to/card.png");
  process.exit(1);
}

if (!apiKey) {
  console.error("Missing AI API key. Set AI_AGENT_API_KEY or OPENAI_API_KEY. Set AI_AGENT_BASE_URL / AI_AGENT_MODEL if using another OpenAI-compatible provider.");
  process.exit(1);
}

const absoluteImagePath = path.resolve(imagePath);
const imageBytes = await fs.readFile(absoluteImagePath);
const mimeType = mimeFromPath(absoluteImagePath);
const imageBase64 = imageBytes.toString("base64");
const metadata = await sharp(imageBytes).metadata();
const imageWidth = metadata.width ?? 0;
const imageHeight = metadata.height ?? 0;

const extraction = await extractCardJson({ imageBase64, mimeType });
const embeddedImages = await cropEmbeddedImages(extraction.embeddedImages ?? []);
const payload = {
  source: "external-image-agent",
  word: extraction.word,
  phonetic: extraction.phonetic,
  phoneticUk: extraction.phoneticUk,
  phoneticUs: extraction.phoneticUs,
  partOfSpeech: extraction.partOfSpeech,
  meaningCn: extraction.meaningCn,
  meaningEn: extraction.meaningEn,
  shortMeaningCn: extraction.shortMeaningCn,
  difficulty: extraction.difficulty,
  splitText: extraction.splitText,
  title: extraction.title,
  mnemonicMarkdown: extraction.mnemonicMarkdown,
  exampleSentence: extraction.exampleSentence,
  exampleTranslation: extraction.exampleTranslation,
  links: extraction.links ?? [],
  rawText: extraction.rawText,
  images: [
    {
      kind: "original",
      filename: path.basename(absoluteImagePath),
      mimeType,
      base64: imageBase64
    },
    ...embeddedImages
  ]
};

const response = await fetch(`${siteUrl}/api/import/drafts`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

const result = await response.json();
if (!response.ok) {
  console.error(result);
  process.exit(1);
}

console.log(JSON.stringify({ ...result, previewUrl: `${siteUrl}${result.previewUrl}` }, null, 2));

async function extractCardJson({ imageBase64, mimeType }) {
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
  "mnemonicMarkdown": "记忆方法正文。保留“带你背”“例句”等文本。相关单词请用 [[word:cycle]] 格式。",
  "exampleSentence": "英文例句",
  "exampleTranslation": "中文翻译",
  "links": [{"type":"word","value":"cycle"}],
  "embeddedImages": [
    {"filename":"illustration.png","bbox":{"x":0.1,"y":0.4,"width":0.8,"height":0.3}}
  ],
  "rawText": "OCR 原始文字"
}

bbox 使用 0-1 归一化坐标，定位截图中需要保留到新卡片里的内嵌图片或示意图。`
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
  if (!response.ok) throw new Error(JSON.stringify(result));
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response has no content");
  return JSON.parse(extractJsonObject(content));
}

async function cropEmbeddedImages(items) {
  const cropped = [];
  for (const [index, item] of items.entries()) {
    const bbox = item.bbox;
    if (!bbox || !imageWidth || !imageHeight) continue;
    const left = clampPixel(bbox.x * imageWidth, 0, imageWidth - 1);
    const top = clampPixel(bbox.y * imageHeight, 0, imageHeight - 1);
    const width = clampPixel(bbox.width * imageWidth, 1, imageWidth - left);
    const height = clampPixel(bbox.height * imageHeight, 1, imageHeight - top);
    const bytes = await sharp(absoluteImagePath).extract({ left, top, width, height }).png().toBuffer();
    cropped.push({
      kind: "embedded-illustration",
      filename: item.filename ?? `embedded-${index + 1}.png`,
      mimeType: "image/png",
      base64: bytes.toString("base64")
    });
  }
  return cropped;
}

function clampPixel(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function extractJsonObject(content) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced ?? content).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}
