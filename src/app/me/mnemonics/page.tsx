import Link from "next/link";
import { ArrowLeft, BookOpenCheck, ExternalLink } from "lucide-react";
import { MnemonicSourceType, MnemonicStatus } from "@prisma/client";
import { PublicTopBar } from "@/components/public-top-bar";
import { MyMnemonicsManager } from "@/components/my-mnemonics-manager";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { saveUserMnemonicAction } from "@/lib/services/mnemonic-service";
import { InteriorContainer, InteriorPage } from "@/components/interior-shell";

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
    <InteriorPage className="mn-profile-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "个人中心", href: "/me" },
          { label: "管理我的记忆卡" }
        ]}
        themeVariant="segmented"
      />

      <InteriorContainer wide>
        <section className="mn-profile-subhero" aria-labelledby="my-mnemonics-title">
          <div className="mn-profile-subhero-copy">
            <p className="mn-profile-eyebrow">profile</p>
            <h1 id="my-mnemonics-title" className="mn-profile-subtitle-heading">
              <span className="mn-profile-heading-icon">
                <BookOpenCheck className="h-5 w-5" aria-hidden />
              </span>
              管理我的记忆卡
            </h1>
            <p className="mn-profile-subcopy">
              只管理你自己创建的记忆卡；公开内容会先进入审核。
            </p>
          </div>
          <div className="mn-profile-subhero-side">
            <span>{entries.length.toLocaleString("zh-CN")} 张个人记忆卡</span>
            <div className="mn-profile-subactions">
              <Link href="/me" className="mn-profile-back-link">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                个人中心
              </Link>
              <Button asChild variant="outline" className="mn-profile-button">
                <Link href="/">
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  去首页选词
                </Link>
              </Button>
            </div>
          </div>
        </section>

        <MyMnemonicsManager
          initialEntries={initialEntries}
          initialDefaultPublicMnemonics={user.defaultPublicMnemonics}
          saveUserMnemonicAction={saveUserMnemonicAction}
        />
      </InteriorContainer>
    </InteriorPage>
  );
}
