import crypto from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MnemonicSourceType, MnemonicStatus, UserRole } from "@prisma/client";
import { PublicTopBar } from "@/components/public-top-bar";
import { LevelWordBrowser, type LevelWordItem } from "@/components/level-word-browser";
import { WordMemorySearch } from "@/components/word-memory-search";
import { WordMarkSaveButton } from "@/components/word-mark-save-button";
import { UsageManualButton } from "@/components/usage-manual-button";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { vocabCategories } from "@/lib/vocab-categories";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

const pageSize = 96;

export default async function LevelPage({
  params,
  searchParams
}: {
  params: Promise<{ level: string }>;
  searchParams: Promise<{ page?: string; seed?: string; sort?: string }>;
}) {
  const [{ level }, sp, sessionUser] = await Promise.all([params, searchParams, getSessionUser()]);
  const user = sessionUser;
  const category = vocabCategories.find((item) => item.slug === level);
  if (!category) notFound();

  const sort: "random" | "az" | "za" = sp.sort === "az" || sp.sort === "za" ? sp.sort : "random";
  const canEditOfficial = hasRole(user, UserRole.EDITOR);
  const providedRandomSeed = typeof sp.seed === "string" ? sp.seed.trim().slice(0, 64) : "";
  const requestedPage = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  if (sort === "random" && !providedRandomSeed) {
    const query = new URLSearchParams({ sort: "random", seed: crypto.randomUUID() });
    if (requestedPage > 1) query.set("page", String(requestedPage));
    redirect(`/levels/${category.slug}?${query.toString()}`);
  }
  const randomSeed = sort === "random" ? providedRandomSeed : "";
  const where = { levelTags: { has: category.tag } };
  const allWords = await prisma.word.findMany({
    where,
    select: {
      id: true,
      word: true,
      slug: true
    }
  });
  const wordMarks = user
    ? await prisma.wordMark.findMany({
        where: { userId: user.id, wordId: { in: allWords.map((word) => word.id) } },
        select: { wordId: true, state: true }
      })
    : [];
  const markByWordId = new Map(wordMarks.map((mark) => [mark.wordId, mark.state]));
  const visibleWords = allWords.filter((word) => markByWordId.get(word.id) !== "KNOWN");
  const sortedWords = sortWords(visibleWords, sort, randomSeed, category.slug);
  const totalCount = sortedWords.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageWords = sortedWords.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageWordIds = pageWords.map((word) => word.id);
  const wordDetails = pageWordIds.length
    ? await prisma.word.findMany({
        where: { id: { in: pageWordIds } },
        select: {
          id: true,
          word: true,
          slug: true,
          phoneticUk: true,
          phoneticUs: true,
          audioUkUrl: true,
          audioUsUrl: true,
          partOfSpeech: true,
          meaningCn: true,
          shortMeaningCn: true,
          exampleSentence: true,
          exampleTranslation: true,
          bookmarks: {
            where: { userId: user?.id ?? "__anonymous__", mnemonicEntryId: null },
            select: { id: true },
            take: 1
          },
          mnemonicEntries: {
            where: user
              ? {
                  status: { not: MnemonicStatus.ARCHIVED },
                  OR: [
                    { sourceType: MnemonicSourceType.OFFICIAL },
                    { authorId: user.id, sourceType: { not: MnemonicSourceType.OFFICIAL } }
                  ]
                }
              : { sourceType: MnemonicSourceType.OFFICIAL, status: { not: MnemonicStatus.ARCHIVED } },
            select: {
              id: true,
              authorId: true,
              sourceType: true,
              status: true,
              sortOrder: true,
              userCardOrders: {
                where: { userId: user?.id ?? "__anonymous__" },
                select: { sortOrder: true },
                take: 1
              },
              title: true,
              splitText: true,
              contentMarkdown: true,
              contentHtml: true,
              plainText: true
            },
            orderBy: [{ sourceType: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
          }
        }
      })
    : [];
  const wordDetailsById = new Map(wordDetails.map((word) => [word.id, word]));
  const words = pageWordIds.flatMap((wordId) => {
    const word = wordDetailsById.get(wordId);
    return word ? [word] : [];
  });
  const items: LevelWordItem[] = words.map((word) => ({
    id: word.id,
    word: word.word,
    slug: word.slug,
    phonetic: word.phoneticUs || word.phoneticUk || "",
    audioUkUrl: word.audioUkUrl || "",
    audioUsUrl: word.audioUsUrl || "",
    partOfSpeech: word.partOfSpeech,
    meaningCn: word.meaningCn,
    shortMeaningCn: word.shortMeaningCn,
    exampleSentence: word.exampleSentence || "",
    exampleTranslation: word.exampleTranslation || "",
    markState: markByWordId.get(word.id) ?? null,
    isBookmarked: word.bookmarks.length > 0 || markByWordId.get(word.id) === "UNKNOWN",
    canEditOfficialCards: canEditOfficial,
    mnemonics: [...word.mnemonicEntries].sort((first, second) => compareMnemonicEntries(first, second, user?.id ?? null)).map((entry) => ({
      id: entry.id,
      title: entry.title,
      splitText: entry.splitText || "",
      contentMarkdown: entry.contentMarkdown,
      contentHtml: entry.contentHtml,
      plainText: entry.plainText,
      sourceType: entry.sourceType,
      status: entry.status,
      canEdit: entry.sourceType === MnemonicSourceType.OFFICIAL ? canEditOfficial : entry.authorId === user?.id || hasRole(user, UserRole.ADMIN)
    }))
  }));
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (page > 1) query.set("page", String(page));
    if (sort !== "random") query.set("sort", sort);
    if (sort === "random" && randomSeed) query.set("seed", randomSeed);
    return `/levels/${category.slug}${query.size ? `?${query.toString()}` : ""}`;
  };

  return (
    <InteriorPage>
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "单词", href: "/words" },
          { label: category.label }
        ]}
        actionsSlot={
          <>
            <UsageManualButton />
            <WordMarkSaveButton />
          </>
        }
        rightSlot={<WordMemorySearch isAuthenticated={Boolean(user)} canEditOfficialCards={canEditOfficial} />}
      />

      <InteriorContainer wide>
        <InteriorHero
          eyebrow="level"
          title={category.label}
          description={category.description}
          meta={`${totalCount.toLocaleString("zh-CN")} 词 / 第 ${currentPage} 页，共 ${totalPages} 页`}
        />

        <LevelWordBrowser
          words={items}
          sort={sort}
          basePath={`/levels/${category.slug}`}
          isAuthenticated={Boolean(user)}
          defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
          canEditOfficialCards={canEditOfficial}
        />

        {totalPages > 1 ? (
          <nav className="mt-8 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm font-semibold">
            {currentPage > 1 ? (
              <Link className="justify-self-start rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] px-4 py-2 transition hover:border-[var(--mn-ink)]" href={pageHref(currentPage - 1)}>
                上一页
              </Link>
            ) : (
              <span className="justify-self-start rounded-md border border-[var(--mn-line)] px-4 py-2 text-[var(--mn-muted)] opacity-50">上一页</span>
            )}
            <span className="rounded-full border border-[var(--mn-line)] bg-[var(--mn-panel)] px-4 py-2 text-xs font-semibold text-[var(--mn-muted)] sm:text-sm">
              第 {currentPage} / {totalPages} 页
            </span>
            {currentPage < totalPages ? (
              <Link className="justify-self-end rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] px-4 py-2 transition hover:border-[var(--mn-ink)]" href={pageHref(currentPage + 1)}>
                下一页
              </Link>
            ) : (
              <span className="justify-self-end rounded-md border border-[var(--mn-line)] px-4 py-2 text-[var(--mn-muted)] opacity-50">下一页</span>
            )}
          </nav>
        ) : null}
      </InteriorContainer>
    </InteriorPage>
  );
}

function sortWords<T extends { word: string; slug: string }>(
  words: T[],
  sort: "random" | "az" | "za",
  randomSeed: string,
  categorySlug: string
) {
  if (sort === "az") return [...words].sort((a, b) => a.word.localeCompare(b.word, "en"));
  if (sort === "za") return [...words].sort((a, b) => b.word.localeCompare(a.word, "en"));

  return words
    .map((word) => ({
      rank: randomRank(`${randomSeed}:${categorySlug}:${word.slug}`),
      word
    }))
    .sort((a, b) => {
      if (a.rank < b.rank) return -1;
      if (a.rank > b.rank) return 1;
      return a.word.word.localeCompare(b.word.word, "en");
    })
    .map((item) => item.word);
}

function randomRank(value: string) {
  return crypto.createHash("sha256").update(value).digest().readBigUInt64BE(0);
}

type MnemonicOrderEntry = {
  id: string;
  authorId: string;
  sourceType: MnemonicSourceType;
  sortOrder: number;
  createdAt?: Date;
  userCardOrders?: { sortOrder: number }[];
};

function compareMnemonicEntries(first: MnemonicOrderEntry, second: MnemonicOrderEntry, userId: string | null) {
  const firstPersonalOrder = first.userCardOrders?.[0]?.sortOrder ?? null;
  const secondPersonalOrder = second.userCardOrders?.[0]?.sortOrder ?? null;
  if (firstPersonalOrder !== null || secondPersonalOrder !== null) {
    if (firstPersonalOrder === null) return 1;
    if (secondPersonalOrder === null) return -1;
    if (firstPersonalOrder !== secondPersonalOrder) return firstPersonalOrder - secondPersonalOrder;
  }

  const firstGroup = mnemonicDisplayGroup(first, userId);
  const secondGroup = mnemonicDisplayGroup(second, userId);
  if (firstGroup !== secondGroup) return firstGroup - secondGroup;
  if (first.sortOrder !== second.sortOrder) return first.sortOrder - second.sortOrder;
  const firstCreatedAt = first.createdAt?.getTime() ?? 0;
  const secondCreatedAt = second.createdAt?.getTime() ?? 0;
  if (firstCreatedAt !== secondCreatedAt) return firstCreatedAt - secondCreatedAt;
  return first.id.localeCompare(second.id);
}

function mnemonicDisplayGroup(entry: { authorId: string; sourceType: MnemonicSourceType }, userId: string | null) {
  if (userId && entry.authorId === userId && entry.sourceType !== MnemonicSourceType.OFFICIAL) return 0;
  if (entry.sourceType === MnemonicSourceType.OFFICIAL) return 1;
  return 2;
}
