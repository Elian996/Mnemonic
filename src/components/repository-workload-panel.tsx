"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Clock3, Loader2, PencilLine } from "lucide-react";
import { repositoryWorkloadRefreshEvent } from "@/lib/repository-workload";
import { cn } from "@/lib/utils";

export type RepositoryWorkloadRecord = {
  id: string;
  label: string;
  rangeLabel: string;
  wordCount: number;
  eventCount: number;
  cardEventCount: number;
  meaningEventCount: number;
  repairEventCount: number;
  sampleWords: string[];
  firstEditLabel: string | null;
  lastEditLabel: string | null;
  isStart: boolean;
  isCurrent: boolean;
};

export function RepositoryWorkloadPanel({ records }: { records: RepositoryWorkloadRecord[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let refreshTimer: number | null = null;
    const refreshWorkload = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        startTransition(() => router.refresh());
      }, 120);
    };

    window.addEventListener(repositoryWorkloadRefreshEvent, refreshWorkload);
    return () => {
      window.removeEventListener(repositoryWorkloadRefreshEvent, refreshWorkload);
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [router]);

  if (!records.length) return null;

  const totalWordSessions = records.reduce((sum, record) => sum + record.wordCount, 0);
  const latestRecord = [...records].reverse().find((record) => record.eventCount > 0);
  const firstRecord = records[0];

  return (
    <section className="mx-auto max-w-7xl px-5 pt-7 sm:px-8">
      <div className="overflow-hidden rounded-[28px] bg-[#111113] shadow-[0_22px_70px_rgba(0,0,0,0.13)]">
        <div className="grid lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex min-h-48 flex-col justify-between p-6 text-white">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/90 ring-1 ring-white/15">
                <BarChart3 className="h-4 w-4 text-[#7ee0b6]" />
                半天工作量
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-normal">工作量记录</h2>
              <p className="mt-2 text-sm leading-6 text-white/60">
                从 {firstRecord.label} {firstRecord.rangeLabel} 开始
              </p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
                <p className="text-xs font-medium text-white/55">累计</p>
                <p className="mt-1 text-2xl font-semibold">{totalWordSessions}</p>
              </div>
              <div className="rounded-2xl bg-[#7ee0b6] px-4 py-3 text-[#06281c]">
                <p className="text-xs font-semibold text-[#176044]">最近</p>
                <p className="mt-1 text-2xl font-semibold">{latestRecord?.wordCount ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="min-w-0 bg-white p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1d1d1f]">按半天归档</p>
                <p className="mt-1 text-sm text-[#6e6e73]">每段内同一个单词只记一次</p>
              </div>
              <div className="hidden items-center gap-2 rounded-full bg-[#f5f5f7] px-3 py-2 text-sm font-semibold text-[#515154] sm:inline-flex">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
                {isPending ? "同步中" : "12 小时 / 档"}
              </div>
            </div>

            <div className="-mx-1 mt-4 overflow-x-auto pb-1">
              <div className="flex min-w-max gap-3 px-1">
                {records.map((record) => (
                  <article
                    key={record.id}
                    className={cn(
                      "w-60 shrink-0 rounded-3xl border bg-[#fbfbfd] p-4 transition",
                      record.isCurrent
                        ? "border-[#7ee0b6] shadow-[0_14px_30px_rgba(18,123,83,0.12)]"
                        : record.isStart
                          ? "border-[#ffd88a] shadow-[0_14px_30px_rgba(130,86,0,0.10)]"
                          : "border-black/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#1d1d1f]">{record.label}</p>
                        <p className="mt-1 text-xs font-medium text-[#6e6e73]">{record.rangeLabel}</p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          record.isCurrent
                            ? "bg-[#d9f8ea] text-[#087443]"
                            : record.isStart
                              ? "bg-[#fff2d2] text-[#8a5a00]"
                              : "bg-[#f0f0f2] text-[#6e6e73]"
                        )}
                      >
                        {record.isCurrent ? "进行中" : record.isStart ? "起点" : "归档"}
                      </span>
                    </div>

                    <div className="mt-5 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-4xl font-semibold tracking-normal text-[#111113]">{record.wordCount}</p>
                        <p className="mt-1 text-xs font-semibold text-[#6e6e73]">个单词</p>
                      </div>
                      <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm ring-1 ring-black/5">
                        <p className="text-sm font-semibold text-[#1d1d1f]">{record.eventCount}</p>
                        <p className="text-xs text-[#86868b]">次修改</p>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs font-semibold">
                      <div className="rounded-2xl bg-[#eef7ff] px-3 py-2 text-[#075c9c]">
                        卡片 {record.cardEventCount}
                      </div>
                      <div className="rounded-2xl bg-[#fff4e5] px-3 py-2 text-[#8a4f00]">
                        释义 {record.meaningEventCount}
                      </div>
                      <div className="rounded-2xl bg-[#eefaf2] px-3 py-2 text-[#11723f]">
                        标记 {record.repairEventCount}
                      </div>
                    </div>

                    {record.sampleWords.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {record.sampleWords.slice(0, 4).map((word) => (
                          <span key={word} className="max-w-full truncate rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[#515154] ring-1 ring-black/5">
                            {word}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-medium text-[#86868b] ring-1 ring-black/5">
                        <PencilLine className="h-3.5 w-3.5" />
                        暂无修改
                      </div>
                    )}

                    {record.firstEditLabel || record.lastEditLabel ? (
                      <p className="mt-3 text-xs font-medium text-[#86868b]">
                        {record.firstEditLabel}
                        {record.lastEditLabel && record.lastEditLabel !== record.firstEditLabel ? ` - ${record.lastEditLabel}` : ""}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
