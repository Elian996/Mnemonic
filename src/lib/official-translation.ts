import crypto from "node:crypto";

type TranslationProvider = "baidu" | "youdao";

export type OfficialTranslationResult = {
  provider: TranslationProvider;
  text: string;
};

export async function translateEnglishToChineseOfficial(text: string): Promise<OfficialTranslationResult | null> {
  const q = text.trim();
  if (!q) return null;

  const providers = configuredProviderOrder();
  for (const provider of providers) {
    const result = provider === "baidu" ? await translateWithBaidu(q) : await translateWithYoudao(q);
    if (result?.text) return result;
  }
  return null;
}

export function hasOfficialTranslationConfig() {
  return Boolean(readBaiduConfig() || readYoudaoConfig());
}

function configuredProviderOrder(): TranslationProvider[] {
  const configured = (process.env.TRANSLATION_PROVIDER || process.env.OFFICIAL_TRANSLATION_PROVIDER || "")
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is TranslationProvider => item === "baidu" || item === "youdao");
  const defaults: TranslationProvider[] = ["baidu", "youdao"];
  return Array.from(new Set([...configured, ...defaults]));
}

function readBaiduConfig() {
  const appId = process.env.BAIDU_TRANSLATE_APP_ID || process.env.BAIDU_FANYI_APP_ID;
  const secret = process.env.BAIDU_TRANSLATE_SECRET || process.env.BAIDU_TRANSLATE_KEY || process.env.BAIDU_FANYI_SECRET;
  return appId && secret ? { appId, secret } : null;
}

function readYoudaoConfig() {
  const appKey = process.env.YOUDAO_APP_KEY || process.env.YOUDAO_TRANSLATE_APP_KEY;
  const appSecret = process.env.YOUDAO_APP_SECRET || process.env.YOUDAO_TRANSLATE_APP_SECRET;
  return appKey && appSecret ? { appKey, appSecret } : null;
}

async function translateWithBaidu(q: string): Promise<OfficialTranslationResult | null> {
  const config = readBaiduConfig();
  if (!config) return null;

  const salt = crypto.randomUUID();
  const sign = md5(`${config.appId}${q}${salt}${config.secret}`);
  const body = new URLSearchParams({
    q,
    from: "en",
    to: "zh",
    appid: config.appId,
    salt,
    sign
  });
  const payload = await fetchJsonWithTimeout<BaiduTranslateResponse>(
    "https://fanyi-api.baidu.com/api/trans/vip/translate",
    body,
    10000
  );
  const text = payload?.trans_result?.map((item) => item.dst).filter(Boolean).join("；") ?? "";
  return text ? { provider: "baidu", text } : null;
}

async function translateWithYoudao(q: string): Promise<OfficialTranslationResult | null> {
  const config = readYoudaoConfig();
  if (!config) return null;

  const salt = crypto.randomUUID();
  const curtime = Math.floor(Date.now() / 1000).toString();
  const sign = sha256(`${config.appKey}${youdaoInput(q)}${salt}${curtime}${config.appSecret}`);
  const body = new URLSearchParams({
    q,
    from: "en",
    to: "zh-CHS",
    appKey: config.appKey,
    salt,
    sign,
    signType: "v3",
    curtime,
    strict: "true"
  });
  const payload = await fetchJsonWithTimeout<YoudaoTranslateResponse>(
    "https://openapi.youdao.com/api",
    body,
    10000
  );
  const text = payload?.errorCode === "0" ? payload.translation?.filter(Boolean).join("；") ?? "" : "";
  return text ? { provider: "youdao", text } : null;
}

async function fetchJsonWithTimeout<T>(url: string, body: URLSearchParams, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function youdaoInput(value: string) {
  return value.length <= 20 ? value : `${value.slice(0, 10)}${value.length}${value.slice(-10)}`;
}

function md5(value: string) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

type BaiduTranslateResponse = {
  trans_result?: Array<{ src?: string; dst: string }>;
};

type YoudaoTranslateResponse = {
  errorCode?: string;
  translation?: string[];
};
