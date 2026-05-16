export type BrowserAiSettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

const defaults: BrowserAiSettings = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini"
};

export function readBrowserAiSettings(): BrowserAiSettings {
  if (typeof window === "undefined") return defaults;
  return {
    apiKey: window.localStorage.getItem("mnemonic_ai_api_key")?.trim() ?? "",
    baseUrl: window.localStorage.getItem("mnemonic_ai_base_url")?.trim() || defaults.baseUrl,
    model: window.localStorage.getItem("mnemonic_ai_model")?.trim() || defaults.model
  };
}

export function writeBrowserAiSettings(settings: BrowserAiSettings) {
  window.localStorage.setItem("mnemonic_ai_api_key", settings.apiKey.trim());
  window.localStorage.setItem("mnemonic_ai_base_url", settings.baseUrl.trim() || defaults.baseUrl);
  window.localStorage.setItem("mnemonic_ai_model", settings.model.trim() || defaults.model);
}

export function clearBrowserAiSettings() {
  window.localStorage.removeItem("mnemonic_ai_api_key");
  window.localStorage.removeItem("mnemonic_ai_base_url");
  window.localStorage.removeItem("mnemonic_ai_model");
}

export function browserAiHeaders() {
  const settings = readBrowserAiSettings();
  if (!settings.apiKey) return undefined;
  return {
    "x-mnemonic-ai-key": settings.apiKey,
    "x-mnemonic-ai-base-url": settings.baseUrl,
    "x-mnemonic-ai-model": settings.model
  };
}
