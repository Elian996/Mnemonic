import Link from "next/link";
import { ChevronRight, Layers3, ListChecks, Sparkles } from "lucide-react";
import type { LevelTag } from "@prisma/client";
import { RepositoryDeleteButton } from "@/components/repository-delete-button";
import { WordCardPopupButton } from "@/components/word-card-popup-button";
import type { VocabCategory } from "@/lib/vocab-categories";
import { cn } from "@/lib/utils";

export type MissingMnemonicWord = {
  id: string;
  word: string;
  slug: string;
  meaning: string;
};

export type MissingMnemonicCategory = Pick<VocabCategory, "tag" | "label" | "description"> & {
  totalCount: number;
  missingCount: number;
  words: MissingMnemonicWord[];
  href: string;
};

export function RepositoryMissingMnemonicPanel({
  groups,
  isAuthenticated,
  defaultUserCardVisibility = "private",
  canEditOfficialCards = false
}: {
  groups: MissingMnemonicCategory[];
  isAuthenticated: boolean;
  defaultUserCardVisibility?: "private" | "public";
  canEditOfficialCards?: boolean;
}) {
  const totalMissing = groups.reduce((sum, group) => sum + group.missingCount, 0);
  const totalWords = groups.reduce((sum, group) => sum + group.totalCount, 0);
  const completedWords = Math.max(0, totalWords - totalMissing);
  const completionRate = totalWords ? Math.round((completedWords / totalWords) * 100) : 100;
  const missingLevels = groups.filter((group) => group.missingCount > 0).length;

  return (
    <section className="mx-auto max-w-7xl px-5 pt-6 sm:px-8">
      <details
        open={totalMissing > 0}
        className="group overflow-hidden rounded-[28px] bg-white/95 shadow-[0_18px_55px_rgba(0,0,0,0.08)] ring-1 ring-black/5"
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-5 py-4 marker:hidden sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", totalMissing ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800")}>
              {totalMissing ? <Layers3 className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-normal text-[#1d1d1f]">缺卡总览</h2>
              <p className="mt-1 text-sm text-[#6e6e73]">
                {totalMissing
                  ? `${missingLevels} 个级别还有 ${totalMissing.toLocaleString("zh-CN")} 个单词没有记忆卡。`
                  : "当前级别词库都有记忆卡。"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm font-semibold text-[#6e6e73]">
            <span>{totalMissing ? "展开查看" : "查看明细"}</span>
            <ChevronRight className="h-4 w-4 transition group-open:rotate-90" />
          </div>
        </summary>

        <div className="border-t border-black/5 px-5 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="缺卡单词" value={totalMissing.toLocaleString("zh-CN")} tone={totalMissing ? "attention" : "clean"} />
            <Metric label="覆盖进度" value={`${completionRate}%`} tone={completionRate === 100 ? "clean" : "neutral"} />
            <Metric label="涉及级别" value={`${missingLevels}/${groups.length}`} tone={missingLevels ? "attention" : "clean"} />
          </div>

          <div className="mt-5 divide-y divide-black/5">
            {groups.map((group) => (
              <MissingGroup
                key={group.tag}
                group={group}
                isAuthenticated={isAuthenticated}
                defaultUserCardVisibility={defaultUserCardVisibility}
                canEditOfficialCards={canEditOfficialCards}
              />
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "clean" | "attention" | "neutral" }) {
  return (
    <div
      className={cn(
        "rounded-2xl px-4 py-3 ring-1",
        tone === "clean" && "bg-emerald-50 text-emerald-900 ring-emerald-100",
        tone === "attention" && "bg-sky-50 text-sky-900 ring-sky-100",
        tone === "neutral" && "bg-[#f5f5f7] text-[#1d1d1f] ring-black/5"
      )}
    >
      <div className="text-2xl font-semibold tracking-normal">{value}</div>
      <div className="mt-1 text-xs font-semibold">{label}</div>
    </div>
  );
}

function MissingGroup({
  group,
  isAuthenticated,
  defaultUserCardVisibility,
  canEditOfficialCards
}: {
  group: MissingMnemonicCategory;
  isAuthenticated: boolean;
  defaultUserCardVisibility: "private" | "public";
  canEditOfficialCards: boolean;
}) {
  const completedCount = Math.max(0, group.totalCount - group.missingCount);
  const completionRate = group.totalCount ? Math.round((completedCount / group.totalCount) * 100) : 100;
  const previewLimitReached = group.missingCount > group.words.length;

  return (
    <section className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[#1d1d1f]">{group.label}</h3>
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", group.missingCount ? "bg-sky-50 text-sky-800" : "bg-emerald-50 text-emerald-800")}>
              {group.missingCount ? `${group.missingCount.toLocaleString("zh-CN")} 个缺卡` : "已补齐"}
            </span>
            <span className="text-xs font-semibold text-[#6e6e73]">{completionRate}% 覆盖</span>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#6e6e73]">{group.description}</p>
        </div>
        <Link
          href={`${group.href}#word-list`}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[#1d1d1f] px-4 text-sm font-semibold text-white transition hover:bg-[#2d2d2f]"
        >
          <ListChecks className="h-4 w-4" />
          查看全部
        </Link>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#f5f5f7]">
        <div className="h-full rounded-full bg-[#0071e3]" style={{ width: `${completionRate}%` }} />
      </div>

      {group.words.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {group.words.map((word) => (
            <span
              key={word.id}
              title={word.meaning}
              className="inline-flex h-9 max-w-full items-center gap-1 rounded-full border border-sky-200 bg-sky-50 pl-3 pr-1 text-sm font-semibold text-sky-900 transition hover:border-sky-400"
            >
              <WordCardPopupButton
                slug={word.slug}
                isAuthenticated={isAuthenticated}
                defaultUserCardVisibility={defaultUserCardVisibility}
                canEditOfficialCards={canEditOfficialCards}
                ariaLabel={`打开 ${word.word} 单词卡弹窗`}
                className="truncate hover:text-sky-700"
              >
                {word.word}
              </WordCardPopupButton>
              <RepositoryDeleteButton id={word.id} word={word.word} returnTo={`${group.href}#word-list`} variant="chip" />
            </span>
          ))}
          {previewLimitReached ? (
            <Link href={`${group.href}#word-list`} className="inline-flex h-9 items-center rounded-full bg-[#f5f5f7] px-3 text-sm font-semibold text-[#6e6e73] transition hover:text-[#1d1d1f]">
              还有 {(group.missingCount - group.words.length).toLocaleString("zh-CN")} 个
            </Link>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">这一组暂时没有缺卡单词。</p>
      )}
    </section>
  );
}

export function missingMnemonicHref(tag: LevelTag) {
  const query = new URLSearchParams({
    level: tag,
    scope: "empty",
    view: "list",
    reveal: "1",
    sort: "az"
  });
  return `/repository?${query.toString()}`;
}
