import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BookMarked, Check, X } from "lucide-react";
import { MnemonicSourceType, MnemonicStatus } from "@prisma/client";
import { PublicTopBar } from "@/components/public-top-bar";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WikiRichText } from "@/components/wiki-rich-text";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { canReviewSubmissions } from "@/lib/permissions";
import { reviewSubmissionAction } from "@/lib/services/mnemonic-service";
import { InteriorContainer, InteriorHero, InteriorPage, InteriorPanel } from "@/components/interior-shell";

export default async function UserSubmissionsPage() {
  const user = await requireUser();
  if (!canReviewSubmissions(user)) redirect("/me");

  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      sourceType: MnemonicSourceType.USER_PUBLIC,
      status: MnemonicStatus.PENDING_REVIEW
    },
    include: { targetWord: true, author: true },
    orderBy: [{ createdAt: "asc" }]
  });

  return (
    <InteriorPage>
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "个人中心", href: "/me" },
          { label: "用户创作记忆卡" }
        ]}
      />

      <InteriorContainer wide>
        <InteriorHero
          eyebrow="review"
          title={
            <span className="inline-flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--mn-line)] text-[var(--mn-muted)]">
                <BookMarked className="h-5 w-5" />
              </span>
              用户创作记忆卡
            </span>
          }
          description="用户选择公开的个人记忆卡会进入这里；审核通过后公开展示，审核失败则退回作者。"
          meta={`${entries.length.toLocaleString("zh-CN")} 张待审核`}
          actions={
            <Link href="/me" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--mn-muted)] transition hover:text-[var(--mn-ink)]">
              <ArrowLeft className="h-4 w-4" />
              个人中心
            </Link>
          }
        />

        <div className="mt-8 space-y-4">
          {entries.map((entry) => (
            <InteriorPanel key={entry.id} className="p-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <article className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/word/${entry.targetWord.slug}`} className="text-xl font-semibold transition hover:text-[var(--mn-red)]">
                      {entry.targetWord.word}
                    </Link>
                    <StatusBadge value={entry.status} />
                    <span className="text-sm text-[var(--mn-muted)]">作者：{entry.author.displayName}</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--mn-muted)]">{entry.targetWord.shortMeaningCn}</p>
                  {entry.splitText ? <p className="mt-4 text-sm font-semibold">划分：{entry.splitText}</p> : null}
                  <div className="mt-3 rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] p-4 text-sm leading-7">
                    <WikiRichText html={entry.contentHtml} />
                  </div>
                </article>

                <form action={reviewSubmissionAction} className="space-y-3 rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] p-4">
                  <input type="hidden" name="entryId" value={entry.id} />
                  <input type="hidden" name="returnTo" value="user-submissions" />
                  <Textarea name="reviewNote" placeholder="审核意见，会发送给原作者" />
                  <input type="hidden" name="editorScore" value="6" />
                  <div className="flex flex-wrap gap-2">
                    <Button name="decision" value="approve" type="submit">
                      <Check className="h-4 w-4" />
                      审核通过
                    </Button>
                    <Button name="decision" value="reject" type="submit" variant="destructive">
                      <X className="h-4 w-4" />
                      审核失败
                    </Button>
                  </div>
                </form>
              </div>
            </InteriorPanel>
          ))}

          {!entries.length ? (
            <InteriorPanel className="p-6 text-sm leading-6 text-[var(--mn-muted)]">
              暂无用户公开创作需要审核。
            </InteriorPanel>
          ) : null}
        </div>
      </InteriorContainer>
    </InteriorPage>
  );
}
