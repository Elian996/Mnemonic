import { z } from "zod";
import { WordAutofill } from "@/lib/word-autofill";

const aiWordAutofillSchema = z.object({
  phoneticUk: z.string().default(""),
  phoneticUs: z.string().default(""),
  partOfSpeech: z.string().default(""),
  meaningCn: z.string().default(""),
  meaningEn: z.string().default(""),
  shortMeaningCn: z.string().default(""),
  exampleSentence: z.string().default(""),
  exampleTranslation: z.string().default(""),
  difficulty: z.coerce.number().int().min(1).max(5).default(3)
});

type AiWordAutofillOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
};

export async function getAiWordAutofill(
  word: string,
  options: AiWordAutofillOptions = {}
): Promise<Omit<WordAutofill, "word" | "source"> | null> {
  const apiKey = options.apiKey || process.env.AI_AUTOFILL_API_KEY || process.env.AI_AGENT_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = options.baseUrl || process.env.AI_AUTOFILL_BASE_URL || process.env.AI_AGENT_BASE_URL || "https://api.openai.com/v1";
  const model = options.model || process.env.AI_AUTOFILL_MODEL || process.env.AI_AGENT_MODEL || "gpt-4.1-mini";
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const response = await fetch(endpoint, {
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
            "你是严谨的英汉词典编辑。只输出 JSON，不要 Markdown。不要生成助记方法。若不确定字段，请留空字符串，不要编造。"
        },
        {
          role: "user",
          content: `请为英文单词 "${word}" 填写词典字段，必须适合中文英语学习者。
必须填写 phoneticUk 和 phoneticUs。音标必须使用 IPA，并用 / / 包裹。如果英美音相同，两个字段填相同值。

输出 JSON：
{
  "phoneticUk": "英音音标，例如 /ˈsɪlɪndə(r)/",
  "phoneticUs": "美音音标",
  "partOfSpeech": "词性，例如 n. / v. / adj.",
  "meaningCn": "完整中文释义，用中文分号分隔",
  "meaningEn": "简洁英文释义",
  "shortMeaningCn": "短中文释义，最多 12 个汉字",
  "exampleSentence": "一个自然英文例句",
  "exampleTranslation": "例句中文翻译",
  "difficulty": 1-5
}`
        }
      ]
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`AI autofill failed: ${response.status} ${message}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI autofill response has no content");
  const parsed = aiWordAutofillSchema.parse(JSON.parse(extractJsonObject(content)));
  return parsed;
}

function extractJsonObject(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const text = (fenced ?? content).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}
