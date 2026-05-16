"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { browserAiHeaders } from "@/lib/ai-browser-settings";
import { ImportProgressPanel } from "@/components/import-progress-panel";
import { estimateImageImport, progressFromElapsed, rememberImportDuration } from "@/lib/import-progress";

type BatchDraft = {
  id: string;
  word: string;
  previewUrl: string;
};

const LAST_BATCH_STORAGE_KEY = "mnemonic:last-import-batch";

export function ImportImageUploadForm() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [modeLabel, setModeLabel] = useState<"识别" | "拆分">("识别");
  const [progress, setProgress] = useState({
    percent: 0,
    elapsedSeconds: 0,
    remainingSeconds: 0,
    estimatedSeconds: 0,
    detail: ""
  });
  const [drafts, setDrafts] = useState<BatchDraft[]>([]);
  const startedAtRef = useRef(0);
  const estimatedSecondsRef = useRef(0);
  const unitsRef = useRef(1);
  const progressKindRef = useRef<"image-single" | "image-batch">("image-single");

  useEffect(() => {
    const saved = window.localStorage.getItem(LAST_BATCH_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as BatchDraft[];
      if (Array.isArray(parsed) && parsed.length) {
        setDrafts(parsed);
        setStatus(`上次批量识别生成了 ${parsed.length} 个导入草稿。`);
      }
    } catch {
      window.localStorage.removeItem(LAST_BATCH_STORAGE_KEY);
    }
  }, []);

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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode = submitter?.value === "batch" ? "batch" : "single";
    const file = formData.get("image");
    if (!(file instanceof File) || file.size === 0) {
      setStatus("请先选择图片");
      return;
    }

    const estimate = estimateImageImport(file, mode);
    startedAtRef.current = performance.now();
    estimatedSecondsRef.current = estimate.seconds;
    unitsRef.current = estimate.units;
    progressKindRef.current = mode === "batch" ? "image-batch" : "image-single";
    setBusy(true);
    setProgress({
      percent: 8,
      elapsedSeconds: 0,
      remainingSeconds: estimate.seconds,
      estimatedSeconds: estimate.seconds,
      detail: `按 ${estimate.label} ${mode === "batch" ? "长截图批量拆分" : "单图识别"}估算；完成后会用真实耗时校准下一次预计时间。`
    });
    setDrafts([]);
    setModeLabel(mode === "batch" ? "拆分" : "识别");
    setStatus(mode === "batch" ? "正在拆分长截图..." : "正在识别图片...");
    const headers = browserAiHeaders();
    try {
      const response = await fetch(mode === "batch" ? "/api/import/image-batch" : "/api/import/image", {
        method: "POST",
        body: formData,
        headers
      });
      const payload = (await response.json()) as { previewUrl?: string; drafts?: BatchDraft[]; count?: number; error?: string };
      if (!response.ok) {
        setStatus(payload.error ?? "图片导入失败");
        return;
      }
      const elapsedSeconds = (performance.now() - startedAtRef.current) / 1000;
      rememberImportDuration(progressKindRef.current, unitsRef.current, elapsedSeconds);
      setProgress((current) => ({
        ...current,
        percent: 100,
        elapsedSeconds,
        remainingSeconds: 0
      }));
      if (mode === "batch") {
        const nextDrafts = payload.drafts ?? [];
        setDrafts(nextDrafts);
        window.localStorage.setItem(LAST_BATCH_STORAGE_KEY, JSON.stringify(nextDrafts));
        setStatus(`已生成 ${payload.count ?? nextDrafts.length} 个导入草稿。`);
        if (nextDrafts.length) {
          router.push(`/imports?batch=${encodeURIComponent(nextDrafts.map((draft) => draft.id).join(","))}`);
        }
        return;
      }
      if (payload.previewUrl) router.push(payload.previewUrl);
    } catch {
      setStatus("图片导入失败，请检查开发服务和 AI 配置");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">上传记忆卡片图片</h2>
        <p className="mt-1 text-sm text-muted-foreground">适合截图、长截图和图片卡片。没有 AI Key 时会自动使用本机 OCR。</p>
      </div>
      <input
        type="file"
        name="image"
        accept="image/png,image/jpeg,image/webp"
        className="rounded-lg border bg-background p-3 text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-secondary-foreground"
      />
      <Button disabled={busy}>
        <Upload className="h-4 w-4" />
        {busy ? "识别中..." : "识别并生成草稿"}
      </Button>
      <Button name="mode" value="batch" variant="outline" disabled={busy}>
        <Upload className="h-4 w-4" />
        {busy ? "拆分中..." : "长截图批量拆分"}
      </Button>
      {busy ? (
        <ImportProgressPanel
          title={`${modeLabel}进度`}
          progress={progress.percent}
          elapsedSeconds={progress.elapsedSeconds}
          remainingSeconds={progress.remainingSeconds}
          estimatedSeconds={progress.estimatedSeconds}
          detail={progress.detail}
          stages={[
            { label: "上传图片", activeAt: 8 },
            { label: modeLabel === "拆分" ? "拆分截图" : "识别内容", activeAt: 35 },
            { label: "生成草稿", activeAt: 72 }
          ]}
        />
      ) : null}
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {drafts.length ? (
        <div className="grid gap-2 rounded-lg bg-muted p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">上一批识别结果</span>
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
