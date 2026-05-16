"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { browserAiHeaders } from "@/lib/ai-browser-settings";
import { ImportProgressPanel } from "@/components/import-progress-panel";
import { estimateMarkdownImport, progressFromElapsed, rememberImportDuration } from "@/lib/import-progress";

type BatchDraft = {
  id: string;
  word: string;
  previewUrl: string;
};

const LAST_MARKDOWN_BATCH_STORAGE_KEY = "mnemonic:last-markdown-import-batch";

export function ImportMarkdownForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [filename, setFilename] = useState("");
  const [drafts, setDrafts] = useState<BatchDraft[]>([]);
  const [progress, setProgress] = useState({
    percent: 0,
    elapsedSeconds: 0,
    remainingSeconds: 0,
    estimatedSeconds: 0,
    detail: ""
  });
  const startedAtRef = useRef(0);
  const estimatedSecondsRef = useRef(0);
  const unitsRef = useRef(1);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      const elapsedSeconds = (performance.now() - startedAtRef.current) / 1000;
      const estimatedSeconds = estimatedSecondsRef.current;
      setProgress((current) => ({
        ...current,
        percent: progressFromElapsed(elapsedSeconds, estimatedSeconds),
        elapsedSeconds,
        remainingSeconds: Math.max(0, estimatedSeconds - elapsedSeconds),
        estimatedSeconds
      }));
    }, 500);
    return () => window.clearInterval(timer);
  }, [busy]);

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setFilename(file?.name ?? "");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get("markdownFile");
    const pastedMarkdown = String(formData.get("contentMarkdown") || "").trim();
    const fileMarkdown = file instanceof File && file.size > 0 ? (await file.text()).trim() : "";
    const contentMarkdown = fileMarkdown || pastedMarkdown;
    if (!contentMarkdown) {
      setStatus("请粘贴 Markdown 内容，或选择 .md 文件");
      return;
    }

    const estimate = estimateMarkdownImport(contentMarkdown);
    startedAtRef.current = performance.now();
    estimatedSecondsRef.current = estimate.seconds;
    unitsRef.current = estimate.units;
    setProgress({
      percent: 8,
      elapsedSeconds: 0,
      remainingSeconds: estimate.seconds,
      estimatedSeconds: estimate.seconds,
      detail: `按 ${estimate.label} 估算；完成后会用真实耗时校准下一次预计时间。`
    });
    setBusy(true);
    setDrafts([]);
    setStatus(fileMarkdown ? "正在读取文件，并让 AI 拆分多张草稿..." : "正在让 AI 拆分 Markdown 草稿...");
    try {
      const response = await fetch("/api/import/markdown-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(browserAiHeaders() ?? {})
        },
        body: JSON.stringify({
          contentMarkdown,
          filename: file instanceof File && file.size > 0 ? file.name : undefined
        })
      });
      const payload = (await response.json()) as { drafts?: BatchDraft[]; count?: number; error?: string };
      if (!response.ok) {
        setStatus(payload.error ?? "Markdown 导入失败");
        return;
      }
      const nextDrafts = payload.drafts ?? [];
      const elapsedSeconds = (performance.now() - startedAtRef.current) / 1000;
      rememberImportDuration("markdown", unitsRef.current, elapsedSeconds);
      setProgress((current) => ({
        ...current,
        percent: 100,
        elapsedSeconds,
        remainingSeconds: 0
      }));
      setDrafts(nextDrafts);
      window.localStorage.setItem(LAST_MARKDOWN_BATCH_STORAGE_KEY, JSON.stringify(nextDrafts));
      setStatus(`已生成 ${payload.count ?? nextDrafts.length} 个导入草稿。`);
      if (nextDrafts.length) {
        router.push(`/imports?batch=${encodeURIComponent(nextDrafts.map((draft) => draft.id).join(","))}`);
      }
    } catch {
      setStatus("Markdown 导入失败，请检查内容格式和 AI 配置");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">Markdown 批量导入</h2>
        <p className="mt-1 text-sm text-muted-foreground">粘贴一整批词条，或选择 .md/.txt 文件。AI 会识别边界并拆成多张可编辑草稿。</p>
      </div>
      <input
        type="file"
        name="markdownFile"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        onChange={onFileChange}
        className="rounded-lg border bg-background p-3 text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-secondary-foreground"
      />
      {filename ? <p className="text-sm text-muted-foreground">已选择：{filename}</p> : null}
      <Textarea
        name="contentMarkdown"
        placeholder={"bunch\n音标： /bʌntʃ/ 释义： n. 一束；一群\n\n老王带你背： 联想：bun（小圆面包）+ ch -> 一群小圆面包 -> 一群\n\n例句： She bought a bunch of flowers. 她买了一束花。\n\noutside\n音标： /ˌaʊtˈsaɪd/ 释义： adv./prep./n./adj. 在外面；外部\n\n老王带你背： 合成词：out（出）+ side（边）-> 外边 -> 在外面\n\n例句： Please wait outside. 请在外面等。"}
        className="min-h-56 rounded-lg bg-background text-base leading-7"
      />
      <Button disabled={busy} className="h-12 rounded-full">
        {busy ? <FileText className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
        {busy ? "AI 拆分中..." : "AI 拆分并生成草稿"}
      </Button>
      {busy ? (
        <ImportProgressPanel
          title="Markdown 导入进度"
          progress={progress.percent}
          elapsedSeconds={progress.elapsedSeconds}
          remainingSeconds={progress.remainingSeconds}
          estimatedSeconds={progress.estimatedSeconds}
          detail={progress.detail}
          stages={[
            { label: "读取内容", activeAt: 8 },
            { label: "AI 拆分词条", activeAt: 35 },
            { label: "生成草稿", activeAt: 72 }
          ]}
        />
      ) : null}
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {drafts.length ? (
        <div className="grid gap-2 rounded-lg bg-muted p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">本次 Markdown 识别结果</span>
            <Link href={`/imports?batch=${encodeURIComponent(drafts.map((draft) => draft.id).join(","))}`} className="text-primary hover:underline">
              打开批量列表
            </Link>
          </div>
          {drafts.map((draft) => (
            <Link key={draft.id} href={draft.previewUrl} className="font-medium text-primary hover:underline">
              {draft.word} 导入草稿
            </Link>
          ))}
        </div>
      ) : null}
    </form>
  );
}
