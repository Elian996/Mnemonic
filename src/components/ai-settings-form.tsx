"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BrowserAiSettings,
  clearBrowserAiSettings,
  readBrowserAiSettings,
  writeBrowserAiSettings
} from "@/lib/ai-browser-settings";

export function AiSettingsForm() {
  const [settings, setSettings] = useState<BrowserAiSettings>({
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini"
  });
  const [status, setStatus] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setSettings(readBrowserAiSettings());
  }, []);

  function update(key: keyof BrowserAiSettings, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function save() {
    writeBrowserAiSettings(settings);
    setStatus("已保存到当前浏览器。自动填写和图片导入会使用这套配置。");
  }

  async function test() {
    const next = {
      apiKey: settings.apiKey.trim(),
      baseUrl: settings.baseUrl.trim() || "https://api.openai.com/v1",
      model: settings.model.trim() || "gpt-4.1-mini"
    };
    if (!next.apiKey) {
      setStatus("请先填写 API Key。");
      return;
    }
    writeBrowserAiSettings(next);
    setTesting(true);
    setStatus("正在测试 AI 自动填写...");
    try {
      const response = await fetch("/api/word-autofill?mode=ai&word=cylinder", {
        headers: {
          "x-mnemonic-ai-key": next.apiKey,
          "x-mnemonic-ai-base-url": next.baseUrl,
          "x-mnemonic-ai-model": next.model
        }
      });
      const payload = (await response.json()) as {
        result?: { source?: string; meaningCn?: string; warning?: string } | null;
        error?: string;
      };
      if (!response.ok || !payload.result) {
        setStatus(payload.error ?? "测试失败：AI 没有返回词条。");
        return;
      }
      if (payload.result.warning) {
        setStatus(`测试未通过：${payload.result.warning}`);
        return;
      }
      setStatus(`测试通过：${payload.result.source || "AI"} 返回了 cylinder：${payload.result.meaningCn || ""}`);
    } catch {
      setStatus("测试失败：无法连接 AI 服务。");
    } finally {
      setTesting(false);
    }
  }

  function clear() {
    clearBrowserAiSettings();
    setSettings({ apiKey: "", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" });
    setStatus("已清除浏览器里的 AI 配置。");
  }

  return (
    <div className="rounded-[30px] bg-white p-6 shadow-sm ring-1 ring-black/5">
      <div className="grid gap-5">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-[#6e6e73]">API Key</span>
          <Input
            type="password"
            value={settings.apiKey}
            onChange={(event) => update("apiKey", event.target.value)}
            placeholder="sk-..."
            className="h-12 rounded-2xl bg-[#f5f5f7]"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-medium text-[#6e6e73]">Base URL</span>
          <Input
            value={settings.baseUrl}
            onChange={(event) => update("baseUrl", event.target.value)}
            placeholder="https://api.openai.com/v1"
            className="h-12 rounded-2xl bg-[#f5f5f7]"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-medium text-[#6e6e73]">模型</span>
          <Input
            value={settings.model}
            onChange={(event) => update("model", event.target.value)}
            placeholder="gpt-4.1-mini"
            className="h-12 rounded-2xl bg-[#f5f5f7]"
          />
        </label>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button type="button" onClick={save} className="rounded-full bg-[#0071e3] px-5 hover:bg-[#0077ed]">
          保存配置
        </Button>
        <Button type="button" variant="outline" onClick={test} disabled={testing} className="rounded-full px-5">
          <CheckCircle2 className="h-4 w-4" />
          {testing ? "测试中" : "测试自动填写"}
        </Button>
        <Button type="button" variant="ghost" onClick={clear} className="rounded-full px-5 text-muted-foreground">
          <Trash2 className="h-4 w-4" />
          清除
        </Button>
      </div>
      {status ? <p className="mt-4 rounded-2xl bg-[#f5f5f7] px-4 py-3 text-sm text-[#424245]">{status}</p> : null}
    </div>
  );
}
