import { AgentImportPayload } from "@/lib/import-drafts/types";

type ExtractMarkdownInput = {
  markdown: string;
  filename?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export async function extractMarkdownImportPayloads({
  markdown,
  filename,
  apiKey: inputApiKey,
  baseUrl: inputBaseUrl,
  model: inputModel
}: ExtractMarkdownInput): Promise<AgentImportPayload[]> {
  const sourceText = markdown.trim();
  if (!sourceText) throw new Error("请粘贴 Markdown 内容，或选择 .md/.txt 文件。");

  const apiKey = inputApiKey || process.env.AI_AGENT_API_KEY || process.env.AI_AUTOFILL_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Markdown 批量导入需要 AI。请先打开 AI 设置，填写 API Key、Base URL 和模型。");
  }

  const baseUrl = inputBaseUrl || process.env.AI_AGENT_BASE_URL || process.env.AI_AUTOFILL_BASE_URL || "https://api.openai.com/v1";
  const model = inputModel || process.env.AI_AGENT_MODEL || process.env.AI_AUTOFILL_MODEL || "gpt-4.1-mini";
  const parsed = await callMarkdownStructuringModel({ baseUrl, apiKey, model, markdown: sourceText, filename });

  return parsed.map((item) => ({
    ...item,
    source: "website-markdown-ai-import",
    rawText: item.rawText || sourceText,
    warnings: [
      "Markdown AI 拆分结果请核对。确认保存后会追加为该单词的新记忆卡。",
      ...toStringArray(item.warnings)
    ]
  }));
}

async function callMarkdownStructuringModel({
  baseUrl,
  apiKey,
  model,
  markdown,
  filename
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  markdown: string;
  filename?: string;
}): Promise<AgentImportPayload[]> {
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
            "你是英语单词记忆卡 Markdown 导入 Agent。你的任务是把用户粘贴的一整批词条拆成多个可保存的卡片 JSON。必须忠实依据输入，不要编造输入外的词条、例句或记忆法。只输出 JSON。"
        },
        {
          role: "user",
          content: `请把下面 Markdown/纯文本按单词拆成数组，输出 JSON：
{
  "cards": [
    {
      "word": "bunch",
      "phonetic": "/bʌntʃ/",
      "phoneticUk": "/bʌntʃ/",
      "phoneticUs": "/bʌntʃ/",
      "partOfSpeech": "n.",
      "meaningCn": "一束；一群",
      "meaningEn": "",
      "shortMeaningCn": "一束；一群",
      "splitText": "bun | ch",
      "title": "bunch 记忆卡片",
      "mnemonicMarkdown": "带你背：\\n联想：bun（小圆面包）+ ch -> 一群小圆面包 -> 一群\\n\\n例句：\\nShe bought a bunch of flowers.\\n她买了一束花。",
      "exampleSentence": "She bought a bunch of flowers.",
      "exampleTranslation": "她买了一束花。",
      "relatedWords": [],
      "links": [],
      "confidence": 0.9,
      "warnings": []
    }
  ]
}

拆分与整理规则：
- 一段输入里通常有多个单词。每个英文单词词头开始一张新卡，后续的“音标、释义、老王带你背/带你背、联想、合成词、词根词缀、例句”等都归到这张卡，直到下一个词头。
- 词头可能单独成行，也可能后面同行跟“音标：/../ 释义：...”。像 "bunch"、"outside" 这样的词都要分别输出一张卡。
- 不要要求用户先填单词；请从内容中识别所有目标单词。
- mnemonicMarkdown 不要重复词头、音标和释义；重点保留记忆方法与例句，按“带你背：”“例句：”整理。
- “老王带你背：”“带你背：”“联想：”“合成词：”“谐音：”“词根：”等都属于记忆方法，保留原意和顺序。
- 如果输入包含“划分：”，填 splitText，并且不要在 mnemonicMarkdown 里重复这一行；没有划分可留空。
- 例句英文和中文翻译要同时放入 mnemonicMarkdown 的“例句：”部分，并尽量填 exampleSentence/exampleTranslation。
- 只有输入里明确出现“相关单词”或类似列表时，才填写 relatedWords；不要把例句里的普通英文单词当相关词。
- 保留用户原文里的中文标点、括号说明和箭头含义，但 JSON 字符串里使用普通文本即可。
- 如果某字段看不到，留空字符串或空数组。不要补写新的记忆法。
- 丢弃页眉、批次标题、说明文字和明显不是单词卡的内容。

文件名：${filename || "pasted-markdown"}

输入内容：
${markdown}`
        }
      ]
    })
  });

  const result = await response.json();
  if (!response.ok) throw new Error(`Markdown AI 拆分失败：${response.status} ${JSON.stringify(result)}`);
  const content = result.choices?.[0]?.message?.content;
  if (!content) throw new Error("Markdown AI 没有返回内容");

  const parsed = JSON.parse(extractJsonObject(content)) as { cards?: Array<Record<string, unknown>> };
  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  return cards
    .map((card) => {
      const word = String(card.word ?? "").trim().toLowerCase();
      const relatedWords = normalizeRelatedWords(card.relatedWords, card.links);
      return {
        source: "website-markdown-ai-import",
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
        mnemonicMarkdown: String(card.mnemonicMarkdown ?? card.contentMarkdown ?? ""),
        exampleSentence: String(card.exampleSentence ?? ""),
        exampleTranslation: String(card.exampleTranslation ?? ""),
        relatedWords,
        links: relatedWords.map((value) => ({ type: "word", value })),
        confidence: Number.isFinite(Number(card.confidence)) ? Number(card.confidence) : 0.75,
        warnings: toStringArray(card.warnings),
        rawText: String(card.rawText ?? "")
      };
    })
    .filter((card) => /^[a-z][a-z'-]*$/i.test(card.word));
}

function normalizeRelatedWords(relatedWords: unknown, links: unknown) {
  const explicit = Array.isArray(relatedWords)
    ? relatedWords.map((word) => String(word).trim().toLowerCase()).filter(Boolean)
    : [];
  const fromLinks = Array.isArray(links)
    ? links
        .map((link) => {
          if (!link || typeof link !== "object") return "";
          const record = link as { type?: unknown; value?: unknown };
          if (record.type && String(record.type).toLowerCase() !== "word") return "";
          return String(record.value ?? "").trim().toLowerCase();
        })
        .filter(Boolean)
    : [];
  return Array.from(new Set([...explicit, ...fromLinks]));
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function extractJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced ?? content).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}
