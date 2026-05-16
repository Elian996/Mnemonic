"use client";

import { useState } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AutofillWordButton() {
  const [status, setStatus] = useState("");

  async function autofill(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.closest("form");
    const wordInput = form?.querySelector<HTMLInputElement>('input[name="word"]');
    if (!wordInput?.value.trim()) return;
    setStatus("正在自动填写...");
    try {
      const response = await fetch(`/api/word-autofill?word=${encodeURIComponent(wordInput.value.trim())}`);
      const payload = (await response.json()) as {
        result?: Record<string, string | number> | null;
        error?: string;
        aiConfigured?: boolean;
      };
      if (!response.ok) {
        setStatus(payload.error ?? "自动填写失败");
        return;
      }
      if (!payload.result) {
        setStatus("没有查到这个词，请检查拼写");
        return;
      }
      const result: Record<string, string | number> = {
        ...payload.result,
        phoneticUk: String(payload.result.phoneticUk || payload.result.phoneticUs || ""),
        phoneticUs: String(payload.result.phoneticUs || payload.result.phoneticUk || ""),
        shortMeaningCn: String(payload.result.shortMeaningCn || payload.result.meaningCn || "")
      };
      for (const [name, value] of Object.entries(result)) {
        const field = form?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
        if (field && name !== "word") {
          field.value = String(value ?? "");
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      const warning = typeof result.warning === "string" ? result.warning : "";
      setStatus(warning ? `已填写；${warning.slice(0, 40)}` : "已自动填写");
    } catch {
      setStatus("查询失败");
    }
  }

  return (
    <div className="grid gap-1">
      <Button type="button" variant="outline" onClick={autofill} className="h-12 whitespace-nowrap rounded-full px-4">
        <Wand2 className="h-4 w-4" />
        自动填写
      </Button>
      {status ? <span className="max-w-36 text-xs leading-5 text-muted-foreground">{status}</span> : null}
    </div>
  );
}
