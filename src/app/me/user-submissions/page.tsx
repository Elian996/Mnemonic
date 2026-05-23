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
import { InteriorContainer, InteriorPage } from "@/components/interior-shell";

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
    <InteriorPage className="mn-profile-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "个人中心", href: "/me" },
          { label: "用户创作记忆卡" }
        ]}
        themeVariant="segmented"
      />

      <InteriorContainer wide>
        <section className="mn-profile-subhero" aria-labelledby="submissions-title">
          <div className="mn-profile-subhero-copy">
            <p className="mn-profile-eyebrow">review</p>
            <h1 id="submissions-title" className="mn-profile-subtitle-heading">
              <span className="mn-profile-heading-icon">
                <BookMarked className="h-5 w-5" aria-hidden />
              </span>
              用户创作记忆卡
            </h1>
            <p className="mn-profile-subcopy">
              用户选择公开的个人记忆卡会进入这里；通过后公开展示。
            </p>
          </div>
          <div className="mn-profile-subhero-side">
            <span>{entries.length.toLocaleString("zh-CN")} 张待审核</span>
            <Link href="/me" className="mn-profile-back-link">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              个人中心
            </Link>
          </div>
        </section>

        <div className="mn-profile-review-list">
          {entries.map((entry) => (
            <section key={entry.id} className="mn-profile-review-item">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <article className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/word/${entry.targetWord.slug}`} className="mn-profile-word-link">
                      {entry.targetWord.word}
                    </Link>
                    <StatusBadge value={entry.status} />
                    <span className="text-sm text-[var(--mn-text-muted)]">
                      作者：{entry.author.displayName}
                    </span>
                  </div>
                  <p className="mn-profile-row-copy mt-3">{entry.targetWord.shortMeaningCn}</p>
                  {entry.splitText ? (
                    <p className="mt-4 text-sm font-semibold">划分：{entry.splitText}</p>
                  ) : null}
                  <div className="mn-profile-review-body">
                    <WikiRichText html={entry.contentHtml} />
                  </div>
                </article>

                <form action={reviewSubmissionAction} className="mn-profile-review-form">
                  <input type="hidden" name="entryId" value={entry.id} />
                  <input type="hidden" name="returnTo" value="user-submissions" />
                  <Textarea name="reviewNote" placeholder="审核意见，会发送给原作者" />
                  <input type="hidden" name="editorScore" value="6" />
                  <div className="flex flex-wrap gap-2">
                    <Button name="decision" value="approve" type="submit" className="mn-profile-button">
                      <Check className="h-4 w-4" aria-hidden />
                      审核通过
                    </Button>
                    <Button name="decision" value="reject" type="submit" variant="destructive">
                      <X className="h-4 w-4" aria-hidden />
                      审核失败
                    </Button>
                  </div>
                </form>
              </div>
            </section>
          ))}

          {!entries.length ? (
            <div className="mn-profile-empty">
              暂无用户公开创作需要审核。
            </div>
          ) : null}
        </div>
      </InteriorContainer>
    </InteriorPage>
  );
}
