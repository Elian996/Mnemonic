import { CheckCircle2, ChevronRight, FileText, TextCursorInput } from "lucide-react";
import { RepositoryLineWrapCleanupResults } from "@/components/repository-line-wrap-cleanup-results";
import type { MnemonicLineWrapCleanupReport } from "@/lib/mnemonic-line-wrap-cleanup-report";
import { cn } from "@/lib/utils";

const previewSize = 96;

export function RepositoryLineWrapCleanupPanel({
  report,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false,
  canExportMemoryCardImages = false
}: {
  report: MnemonicLineWrapCleanupReport | null;
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
  canExportMemoryCardImages?: boolean;
}) {
  if (!report) return null;

  const visibleItems = report.items.slice(0, previewSize);
  const remainingCount = Math.max(0, report.items.length - visibleItems.length);
  const isComplete = report.status === "complete" && report.applied;
  const navigationSlugs = report.items.map((item) => item.slug);

  return (
    <section className="mn-repository-panel-wrap mx-auto max-w-7xl px-5 pt-6 sm:px-8">
      <details
        className="mn-repository-panel group overflow-hidden rounded-[28px] bg-white/95 shadow-[0_18px_55px_rgba(0,0,0,0.08)] ring-1 ring-black/5 dark:bg-card/95 dark:shadow-[0_18px_55px_rgba(0,0,0,0.28)] dark:ring-white/10"
        open={report.items.length > 0}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 marker:hidden sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                isComplete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
              )}
            >
              {isComplete ? <CheckCircle2 className="h-5 w-5" /> : <TextCursorInput className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-normal text-foreground">记忆卡换行整理</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isComplete
                  ? `已按模板规则整理 ${report.updatedEntries.toLocaleString("zh-CN")} 张卡片。`
                  : `已扫描出 ${report.candidateEntries.toLocaleString("zh-CN")} 张疑似硬换行卡片，等待应用。`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
            <span>查看结果</span>
            <ChevronRight className="h-4 w-4 transition group-open:rotate-90" />
          </div>
        </summary>

        <div className="border-t border-border/70 px-5 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="扫描卡片" value={report.totalEntries.toLocaleString("zh-CN")} tone="neutral" />
            <Metric label="命中卡片" value={report.candidateEntries.toLocaleString("zh-CN")} tone={report.candidateEntries ? "attention" : "clean"} />
            <Metric label="已整理" value={report.updatedEntries.toLocaleString("zh-CN")} tone={isComplete ? "clean" : "neutral"} />
          </div>

          <section className="mt-5 border-t border-border/70 pt-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText className="h-4 w-4 text-sky-600" />
              整理规则
            </h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {report.rules.map((rule) => (
                <p key={rule} className="rounded-lg bg-muted px-3 py-2 text-sm leading-6 text-muted-foreground">
                  {rule}
                </p>
              ))}
            </div>
          </section>

          <RepositoryLineWrapCleanupResults
            items={visibleItems}
            navigationSlugs={navigationSlugs}
            isAuthenticated={isAuthenticated}
            defaultUserCardVisibility={defaultUserCardVisibility}
            canEditOfficialCards={canEditOfficialCards}
            canExportMemoryCardImages={canExportMemoryCardImages}
          />

          {remainingCount ? (
            <p className="mt-4 rounded-lg bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
              还剩 {remainingCount.toLocaleString("zh-CN")} 张已写入报告；这里先展示前 {previewSize} 张，完整结果保存在本地报告中。
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "clean" | "attention" | "neutral" }) {
  return (
    <div
      className={cn(
        "mn-repository-metric rounded-2xl px-4 py-3 ring-1",
        tone === "clean" && "bg-emerald-50 text-emerald-900 ring-emerald-100",
        tone === "attention" && "bg-amber-50 text-amber-900 ring-amber-100",
        tone === "neutral" && "bg-muted text-foreground ring-border/70"
      )}
    >
      <div className="text-2xl font-semibold tracking-normal">{value}</div>
      <div className="mt-1 text-xs font-semibold">{label}</div>
    </div>
  );
}
