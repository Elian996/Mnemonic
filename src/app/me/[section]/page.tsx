import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Check, Circle, X } from "lucide-react";
import { WordMarkState } from "@prisma/client";
import { ProfileWordList } from "@/components/profile-word-list";
import { PublicTopBar } from "@/components/public-top-bar";
import { UsageManualButton } from "@/components/usage-manual-button";
import { WordMarkSaveButton } from "@/components/word-mark-save-button";
import { getSessionUser, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

type SectionKey = "known" | "fuzzy" | "unknown";

const wordListSelect = {
  id: true,
  slug: true,
  word: true,
  phoneticUk: true,
  phoneticUs: true,
  shortMeaningCn: true,
  meaningCn: true
} as const;

const sections = {
  known: {
    label: "熟练",
    emptyText: "还没有标记熟练单词。",
    icon: Check,
    state: WordMarkState.KNOWN
  },
  fuzzy: {
    label: "模糊",
    emptyText: "还没有标记模糊单词。",
    icon: Circle,
    state: WordMarkState.FUZZY
  },
  unknown: {
    label: "生词本",
    emptyText: "还没有生词。",
    icon: X,
    state: WordMarkState.UNKNOWN
  }
} satisfies Record<SectionKey, { label: string; emptyText: string; icon: typeof X; state: WordMarkState }>;

const markStateBySection = {
  known: WordMarkState.KNOWN,
  fuzzy: WordMarkState.FUZZY,
  unknown: WordMarkState.UNKNOWN
} satisfies Record<SectionKey, WordMarkState>;

export default async function MeSectionPage({
  params
}: {
  params: Promise<{ section: string }>;
}) {
  const [{ section: rawSection }, sessionUser] = await Promise.all([params, getSessionUser()]);
  if (rawSection === "bookmarks") redirect("/me/unknown");
  if (!isSectionKey(rawSection)) notFound();

  const user = sessionUser ?? (await requireUser());
  const section = sections[rawSection];
  const words = await getMarkedWords(user.id, markStateBySection[rawSection]);
  const Icon = section.icon;

  return (
    <InteriorPage>
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "个人中心", href: "/me" },
          { label: section.label }
        ]}
        actionsSlot={
          <>
            <UsageManualButton />
            <WordMarkSaveButton />
          </>
        }
      />

      <InteriorContainer wide>
        <InteriorHero
          eyebrow="profile"
          title={
            <span className="inline-flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--mn-line)] text-[var(--mn-muted)]">
                <Icon className="h-5 w-5" />
              </span>
              {section.label}
            </span>
          }
          description="点击单词打开记忆卡；可排序，也可进入编辑模式删除。"
          meta={`${words.length.toLocaleString("zh-CN")} 个单词`}
          actions={
            <Link href="/me" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--mn-muted)] transition hover:text-[var(--mn-ink)]">
              <ArrowLeft className="h-4 w-4" />
              个人中心
            </Link>
          }
        />

        <ProfileWordList words={words} emptyText={section.emptyText} kind={rawSection} />
      </InteriorContainer>
    </InteriorPage>
  );
}

function isSectionKey(section: string): section is SectionKey {
  return section === "known" || section === "fuzzy" || section === "unknown";
}

async function getMarkedWords(userId: string, state: WordMarkState) {
  const marks = await prisma.wordMark.findMany({
    where: { userId, state },
    select: {
      id: true,
      updatedAt: true,
      word: { select: wordListSelect }
    },
    orderBy: { updatedAt: "desc" }
  });
  return marks.map((mark) => ({ ...mark.word, joinedAt: mark.updatedAt.toISOString() }));
}
