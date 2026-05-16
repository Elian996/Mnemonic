import Link from "next/link";
import { ArrowLeft, BookOpenCheck, ExternalLink } from "lucide-react";
import { MnemonicSourceType, MnemonicStatus } from "@prisma/client";
import { PublicTopBar } from "@/components/public-top-bar";
import { MyMnemonicsManager } from "@/components/my-mnemonics-manager";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { saveUserMnemonicAction } from "@/lib/services/mnemonic-service";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function MyMnemonicsPage() {
  const user = await requireUser();
  const entries = await prisma.mnemonicEntry.findMany({
    where: {
      authorId: user.id,
      sourceType: { not: MnemonicSourceType.OFFICIAL },
      status: { not: MnemonicStatus.ARCHIVED }
    },
    include: { targetWord: true },
    orderBy: [{ updatedAt: "desc" }]
  });
  const sortedEntries = [...entries].sort((a, b) => {
    const wordCompare = a.targetWord.word.localeCompare(b.targetWord.word, "en");
    if (wordCompare !== 0) return wordCompare;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
  const initialEntries = sortedEntries.map((entry) => ({
    id: entry.id,
    targetWordId: entry.targetWordId,
    title: entry.title,
    splitText: entry.splitText,
    contentMarkdown: entry.contentMarkdown,
    plainText: entry.plainText,
    status: entry.status,
    sourceType: entry.sourceType as "USER_PRIVATE" | "USER_PUBLIC",
    reviewNote: entry.reviewNote,
    sortOrder: entry.sortOrder,
    updatedAt: entry.updatedAt.toISOString(),
    targetWord: {
      word: entry.targetWord.word,
      slug: entry.targetWord.slug,
      shortMeaningCn: entry.targetWord.shortMeaningCn
    }
  }));

  return (
    <InteriorPage>
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "个人中心", href: "/me" },
          { label: "管理我的记忆卡" }
        ]}
      />

      <InteriorContainer wide>
        <InteriorHero
          eyebrow="profile"
          title={
            <span className="inline-flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--mn-line)] text-[var(--mn-muted)]">
                <BookOpenCheck className="h-5 w-5" />
              </span>
              管理我的记忆卡
            </span>
          }
          description="只管理你自己创建的记忆卡；公开内容会先进入审核，通过前不会对外展示。"
          meta={`${entries.length.toLocaleString("zh-CN")} 张个人记忆卡`}
          actions={
            <>
              <Link href="/me" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--mn-muted)] transition hover:text-[var(--mn-ink)]">
                <ArrowLeft className="h-4 w-4" />
                个人中心
              </Link>
              <Button asChild variant="outline">
                <Link href="/words">
                  <ExternalLink className="h-4 w-4" />
                  去单词页新建
                </Link>
              </Button>
            </>
          }
        />

        <MyMnemonicsManager
          initialEntries={initialEntries}
          initialDefaultPublicMnemonics={user.defaultPublicMnemonics}
          saveUserMnemonicAction={saveUserMnemonicAction}
        />
      </InteriorContainer>
    </InteriorPage>
  );
}
