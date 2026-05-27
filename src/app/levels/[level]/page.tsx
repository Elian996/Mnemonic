import crypto from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole, VoteType, type LevelTag } from "@prisma/client";
import { PublicTopBar } from "@/components/public-top-bar";
import { LevelWordBrowser, type LevelWordItem } from "@/components/level-word-browser";
import { DesktopModeOnly } from "@/components/responsive-mode-switch";
import { WordMemorySearch } from "@/components/word-memory-search";
import { WordMarkSaveButton } from "@/components/word-mark-save-button";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { vocabCategories } from "@/lib/vocab-categories";
import { InteriorContainer, InteriorPage } from "@/components/interior-shell";

const pageSize = 96;

type LevelRouteCategory = {
  tag: LevelTag | null;
  slug: string;
  label: string;
  shortLabel: string;
  description: string;
  href: string;
};

const randomCategory: LevelRouteCategory = {
  tag: null,
  slug: "random",
  label: "随机",
  shortLabel: "随机",
  description: "从全部单词里随机混合抽取，不按词库标签分类。",
  href: "/levels/random"
};

export default async function LevelPage({
  params,
  searchParams
}: {
  params: Promise<{ level: string }>;
  searchParams: Promise<{ page?: string; seed?: string; sort?: string }>;
}) {
  const [{ level }, sp, sessionUser] = await Promise.all([params, searchParams, getSessionUser()]);
  const user = sessionUser;
  const category: LevelRouteCategory | undefined =
    level === randomCategory.slug ? randomCategory : vocabCategories.find((item) => item.slug === level);
  if (!category) notFound();

  const sort: "random" | "az" | "za" = sp.sort === "az" || sp.sort === "za" ? sp.sort : "random";
  const canEditOfficial = hasRole(user, UserRole.EDITOR);
  const canExportMemoryCardImages = hasRole(user, UserRole.ADMIN);
  const providedRandomSeed = typeof sp.seed === "string" ? sp.seed.trim().slice(0, 64) : "";
  const requestedPage = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  if (sort === "random" && !providedRandomSeed) {
    const query = new URLSearchParams({ sort: "random", seed: crypto.randomUUID() });
    if (requestedPage > 1) query.set("page", String(requestedPage));
    redirect(`/levels/${category.slug}?${query.toString()}`);
  }
  const randomSeed = sort === "random" ? providedRandomSeed : "";
  const where: Prisma.WordWhereInput = category.tag ? { levelTags: { has: category.tag } } : {};
  let allWords: { id: string; word: string; slug: string }[];
  try {
    allWords = await prisma.word.findMany({
      where,
      select: {
        id: true,
        word: true,
        slug: true
      }
    });
  } catch (error) {
    if (isDatabaseUnavailableError(error)) return <LevelDatabaseUnavailablePage category={category} user={user} />;
    throw error;
  }
  const wordMarks = user
    ? await prisma.wordMark.findMany({
        where: category.tag
          ? { userId: user.id, wordId: { in: allWords.map((word) => word.id) } }
          : { userId: user.id },
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
                    { authorId: user.id, sourceType: { not: MnemonicSourceType.OFFICIAL } },
                    {
                      sourceType: MnemonicSourceType.USER_PUBLIC,
                      isPublic: true,
                      status: { in: [MnemonicStatus.APPROVED, MnemonicStatus.FEATURED] }
                    }
                  ]
                }
              : {
                  status: { not: MnemonicStatus.ARCHIVED },
                  OR: [
                    { sourceType: MnemonicSourceType.OFFICIAL },
                    {
                      sourceType: MnemonicSourceType.USER_PUBLIC,
                      isPublic: true,
                      status: { in: [MnemonicStatus.APPROVED, MnemonicStatus.FEATURED] }
                    }
                  ]
                },
            select: {
              id: true,
              authorId: true,
              sourceType: true,
              status: true,
              isPublic: true,
              sortOrder: true,
              likeCount: true,
              dislikeCount: true,
              bookmarkCount: true,
              votes: {
                where: { userId: user?.id ?? "__anonymous__", type: { in: [VoteType.LIKE, VoteType.DISLIKE] } },
                select: { type: true },
                take: 1
              },
              bookmarks: {
                where: { userId: user?.id ?? "__anonymous__" },
                select: { id: true },
                take: 1
              },
              userCardOrders: {
                where: { userId: user?.id ?? "__anonymous__" },
                select: { sortOrder: true },
                take: 1
              },
              title: true,
              splitText: true,
              contentMarkdown: true,
              contentHtml: true,
              plainText: true,
              updatedAt: true
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
    canExportMemoryCardImages,
    mnemonics: [...word.mnemonicEntries]
      .sort(compareMnemonicEntries)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        splitText: entry.splitText || "",
        contentMarkdown: entry.contentMarkdown,
        contentHtml: entry.contentHtml,
        plainText: entry.plainText,
        sourceType: entry.sourceType,
        status: entry.status,
        likeCount: entry.likeCount,
        dislikeCount: entry.dislikeCount,
        userVoteType: entry.votes[0]?.type ?? null,
        isSaved: entry.bookmarks.length > 0,
        updatedAt: entry.updatedAt.toISOString(),
        canEdit:
          entry.sourceType === MnemonicSourceType.OFFICIAL
            ? canEditOfficial
            : entry.authorId === user?.id || hasRole(user, UserRole.ADMIN)
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
    <InteriorPage className="mn-level-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: category.label }
        ]}
        themeVariant="segmented"
        actionsSlot={<WordMarkSaveButton />}
        rightSlot={
          <DesktopModeOnly>
            <WordMemorySearch
              isAuthenticated={Boolean(user)}
              canEditOfficialCards={canEditOfficial}
              canExportMemoryCardImages={canExportMemoryCardImages}
            />
          </DesktopModeOnly>
        }
      />

      <InteriorContainer wide className="mn-level-container">
        <DesktopModeOnly>
          <section className="mn-level-hero" aria-labelledby="mn-level-title">
            <div className="mn-level-hero-copy">
              <p className="mn-level-eyebrow">{category.tag ? "level" : "random"}</p>
              <h1 id="mn-level-title" className="mn-level-title">
                {category.label}
              </h1>
              <p className="mn-level-description">{category.description}</p>
            </div>
            <div className="mn-level-meta" aria-label="词库进度">
              <span>{totalCount.toLocaleString("zh-CN")} 词</span>
              <span>第 {currentPage} / {totalPages} 页</span>
            </div>
          </section>
        </DesktopModeOnly>

        <LevelWordBrowser
          words={items}
          sort={sort}
          basePath={`/levels/${category.slug}`}
          isAuthenticated={Boolean(user)}
          defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
          canEditOfficialCards={canEditOfficial}
          canExportMemoryCardImages={canExportMemoryCardImages}
        />

        {totalPages > 1 ? (
          <nav className="mn-level-pagination mt-8 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm font-semibold">
            {currentPage > 1 ? (
              <Link
                className="justify-self-start rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] px-4 py-2 transition hover:border-[var(--mn-ink)]"
                href={pageHref(currentPage - 1)}
              >
                上一页
              </Link>
            ) : (
              <span className="justify-self-start rounded-md border border-[var(--mn-line)] px-4 py-2 text-[var(--mn-muted)] opacity-50">
                上一页
              </span>
            )}
            <span className="rounded-full border border-[var(--mn-line)] bg-[var(--mn-panel)] px-4 py-2 text-xs font-semibold text-[var(--mn-muted)] sm:text-sm">
              第 {currentPage} / {totalPages} 页
            </span>
            {currentPage < totalPages ? (
              <Link
                className="justify-self-end rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] px-4 py-2 transition hover:border-[var(--mn-ink)]"
                href={pageHref(currentPage + 1)}
              >
                下一页
              </Link>
            ) : (
              <span className="justify-self-end rounded-md border border-[var(--mn-line)] px-4 py-2 text-[var(--mn-muted)] opacity-50">
                下一页
              </span>
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
  likeCount?: number;
  dislikeCount?: number;
  createdAt?: Date;
  userCardOrders?: { sortOrder: number }[];
};

function compareMnemonicEntries(first: MnemonicOrderEntry, second: MnemonicOrderEntry) {
  const firstPersonalOrder = first.userCardOrders?.[0]?.sortOrder ?? null;
  const secondPersonalOrder = second.userCardOrders?.[0]?.sortOrder ?? null;
  if (firstPersonalOrder !== null || secondPersonalOrder !== null) {
    if (firstPersonalOrder === null) return 1;
    if (secondPersonalOrder === null) return -1;
    if (firstPersonalOrder !== secondPersonalOrder) return firstPersonalOrder - secondPersonalOrder;
  }

  const firstFeedbackScore = mnemonicFeedbackScore(first);
  const secondFeedbackScore = mnemonicFeedbackScore(second);
  if (firstFeedbackScore !== secondFeedbackScore) return secondFeedbackScore - firstFeedbackScore;
  if (first.sortOrder !== second.sortOrder) return first.sortOrder - second.sortOrder;
  const firstCreatedAt = first.createdAt?.getTime() ?? 0;
  const secondCreatedAt = second.createdAt?.getTime() ?? 0;
  if (firstCreatedAt !== secondCreatedAt) return firstCreatedAt - secondCreatedAt;
  return first.id.localeCompare(second.id);
}

function mnemonicFeedbackScore(entry: Pick<MnemonicOrderEntry, "likeCount" | "dislikeCount">) {
  return (entry.likeCount ?? 0) - (entry.dislikeCount ?? 0);
}

function LevelDatabaseUnavailablePage({
  category,
  user
}: {
  category: LevelRouteCategory;
  user: Awaited<ReturnType<typeof getSessionUser>>;
}) {
  return (
    <InteriorPage className="mn-level-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: category.label }
        ]}
      />
      <InteriorContainer>
        <section className="mn-level-hero" aria-labelledby="mn-level-unavailable-title">
          <div className="mn-level-hero-copy">
            <p className="mn-level-eyebrow">{category.tag ? "level" : "random"}</p>
            <h1 id="mn-level-unavailable-title" className="mn-level-title">
              {category.label}
            </h1>
            <p className="mn-level-description">{category.description}</p>
          </div>
          <div className="mn-level-meta" aria-label="词库状态">
            <span>本地数据库未连接</span>
          </div>
        </section>
        <section className="mn-panel mt-8 p-6">
          <h2 className="font-serif text-3xl font-semibold">暂时无法读取词库</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--mn-muted)]">
            当前页面已经进入对应词库，但本地 Postgres 没有运行，所以词表数据无法加载。启动本地数据库后刷新页面即可看到单词列表。
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex h-10 items-center rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] px-4 text-sm font-semibold transition hover:border-[var(--mn-ink)]"
          >
            返回首页
          </Link>
        </section>
      </InteriorContainer>
    </InteriorPage>
  );
}

function isDatabaseUnavailableError(error: unknown) {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  return error instanceof Error && error.message.includes("Can't reach database server");
}
