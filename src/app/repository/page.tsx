import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BookOpenCheck, CircleAlert, Eye, EyeOff, Grid2X2, List, Sparkles, Volume2 } from "lucide-react";
import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole, type LevelTag } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { hasRole } from "@/lib/permissions";
import { getAiExtensionReviewCount, getAiExtensionReviewItems } from "@/lib/ai-extension-route-fill";
import { getAiGeneratedWordCardCount, getAiGeneratedWordCardItems } from "@/lib/ai-generated-word-cards";
import {
  glareLikeLogicReviewWords,
  labelArtifactCleanupAuditAction,
  labelArtifactCleanupPackExcludeAction,
  labelArtifactCleanupScope
} from "@/lib/repository-word-pack";
import { cn } from "@/lib/utils";
import { vocabCategories, type VocabCategory } from "@/lib/vocab-categories";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RepositoryBulkDeleteList } from "@/components/repository-bulk-delete-list";
import { RepositoryDeleteButton } from "@/components/repository-delete-button";
import { RepositoryKeyboardController } from "@/components/repository-keyboard-controller";
import { RepositoryGlobalWordSearch } from "@/components/repository-global-word-search";
import { WordCardPopupButton } from "@/components/word-card-popup-button";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { PublicTopBar } from "@/components/public-top-bar";
import { AiExtensionReviewGrid } from "@/components/ai-extension-review-grid";
import { AiGeneratedWordCardGrid } from "@/components/ai-generated-word-card-grid";
import { bulkDeleteWordsFromRepositoryAction, bulkRemoveWordsFromRepositoryPackAction } from "@/lib/services/word-service";

export const dynamic = "force-dynamic";

type RepositorySearchParams = {
  q?: string;
  sort?: string;
  view?: string;
  reveal?: string;
  scope?: string;
  letter?: string;
  level?: string;
  account?: string;
  page?: string;
  deleted?: string;
  removedFromPack?: string;
};

const pageSize = 120;
const aiExtensionReviewPageSize = 120;
const aiGeneratedWordCardPageSize = 120;

const sortLabels: Record<string, string> = {
  recent: "最近添加",
  oldest: "最早添加",
  az: "按字母 A-Z",
  za: "按字母 Z-A"
};

const baseScopeLabels: Record<string, string> = {
  missingCards: "缺卡单词",
  withCards: "已有卡单词"
};
const scopeLabels: Record<string, string> = {
  ...baseScopeLabels,
  [labelArtifactCleanupScope]: "OCR/逻辑清理词包",
  aiExtensionReview: "AI延伸审核",
  aiGeneratedWordCards: "AI生成单词卡"
};
const accountDetailLabels = {
  all: "全部账号",
  ordinary: "普通账号",
  ordinaryCards: "普通账号创卡",
  pendingPublicCards: "待审核公开卡",
  privateUserCards: "私有用户卡"
} as const;
type AccountDetailMode = keyof typeof accountDetailLabels;
const defaultRepositoryScope = "missingCards";
const activeMnemonicEntryWhere: Prisma.MnemonicEntryWhereInput = {
  status: { not: MnemonicStatus.ARCHIVED }
};

export default async function RepositoryPage({
  searchParams
}: {
  searchParams: Promise<RepositorySearchParams>;
}) {
  const params = await searchParams;
  const user = await requireRole(UserRole.REVIEWER);
  const canUseAiExtensionReview = hasRole(user, UserRole.ADMIN);
  const canUseAiGeneratedWordCards = hasRole(user, UserRole.ADMIN);
  const availableScopeLabels = canUseAiExtensionReview ? scopeLabels : baseScopeLabels;
  const initialGlobalSearchQuery = params.q?.trim() ?? "";
  const sort = sortLabels[params.sort ?? ""] ? String(params.sort) : "az";
  const view = params.view === "list" ? "list" : "grid";
  const reveal = params.reveal === "1";
  const scope = availableScopeLabels[params.scope ?? ""] ? String(params.scope) : defaultRepositoryScope;
  const requestedPage = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const deletedCount = Math.max(0, Number.parseInt(params.deleted ?? "0", 10) || 0);
  const removedFromPackCount = Math.max(0, Number.parseInt(params.removedFromPack ?? "0", 10) || 0);
  const canEditOfficialCards = hasRole(user, UserRole.EDITOR);
  const canExportMemoryCardImages = hasRole(user, UserRole.ADMIN);
  const isAiExtensionReviewScope = scope === "aiExtensionReview" && canUseAiExtensionReview;
  const isAiGeneratedWordCardsScope = scope === "aiGeneratedWordCards" && canUseAiGeneratedWordCards;
  const isSpecialDraftScope = isAiExtensionReviewScope || isAiGeneratedWordCardsScope;
  const aiExtensionReviewCount = canUseAiExtensionReview ? await getAiExtensionReviewCount() : 0;
  const aiGeneratedWordCardCount = canUseAiGeneratedWordCards ? await getAiGeneratedWordCardCount() : 0;
  const labelArtifactCleanupWordIds = canUseAiExtensionReview ? await getLabelArtifactCleanupWordIds() : [];
  const adminOverview = await getAdminCenterOverview();
  const wordCardStats = await getWordCardStats();
  const selectedLevelCategory = getRepositoryLevelCategory(params.level);
  const activeLevelSlug = scope === "missingCards" ? (selectedLevelCategory?.slug ?? "") : "";
  const selectedAccountDetail = getAccountDetailMode(params.account);
  const accountDetails = selectedAccountDetail ? await getAdminAccountDetails(selectedAccountDetail) : null;

  const baseWhere = (): Prisma.WordWhereInput => {
    if (scope === "missingCards") {
      return {
        mnemonicEntries: { none: activeMnemonicEntryWhere },
        ...(selectedLevelCategory ? { levelTags: { has: selectedLevelCategory.tag } } : {})
      };
    }
    if (scope === "withCards") return { mnemonicEntries: { some: activeMnemonicEntryWhere } };
    if (scope === labelArtifactCleanupScope) {
      return labelArtifactCleanupWordIds.length ? { id: { in: labelArtifactCleanupWordIds } } : { id: "__empty__" };
    }
    if (scope === "aiExtensionReview") {
      return { id: "__empty__" };
    }
    if (scope === "aiGeneratedWordCards") {
      return { id: "__empty__" };
    }
    return { mnemonicEntries: { none: activeMnemonicEntryWhere } };
  };
  const where = baseWhere();

  const orderBy =
    sort === "oldest"
      ? { createdAt: "asc" as const }
      : sort === "az"
        ? { word: "asc" as const }
        : sort === "za"
          ? { word: "desc" as const }
          : { createdAt: "desc" as const };

  const activePageSize = isAiExtensionReviewScope ? aiExtensionReviewPageSize : isAiGeneratedWordCardsScope ? aiGeneratedWordCardPageSize : pageSize;
  const totalCount = isAiExtensionReviewScope ? aiExtensionReviewCount : isAiGeneratedWordCardsScope ? aiGeneratedWordCardCount : await prisma.word.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / activePageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const aiExtensionReviewItems = canUseAiExtensionReview
    ? await getAiExtensionReviewItems(aiExtensionReviewPageSize, isAiExtensionReviewScope ? (currentPage - 1) * aiExtensionReviewPageSize : 0)
    : [];
  const aiGeneratedWordCardItems = canUseAiGeneratedWordCards
    ? await getAiGeneratedWordCardItems(aiGeneratedWordCardPageSize, isAiGeneratedWordCardsScope ? (currentPage - 1) * aiGeneratedWordCardPageSize : 0)
    : [];
  const words = isSpecialDraftScope
    ? []
    : await prisma.word.findMany({
        where,
        include: {
          _count: {
            select: { mnemonicEntries: { where: activeMnemonicEntryWhere } }
          },
          mnemonicEntries: {
            where: activeMnemonicEntryWhere,
            orderBy: [{ sourceType: "asc" }, { updatedAt: "desc" }],
            take: 1
          }
        },
        orderBy,
        skip: (currentPage - 1) * pageSize,
        take: pageSize
      });
  const navigationSlugs = words.map((word) => word.slug);

  const hrefFor = (overrides: Partial<RepositorySearchParams>) => {
    const next = {
      sort,
      view,
      reveal: reveal ? "1" : "",
      scope,
      level: activeLevelSlug,
      page: String(currentPage),
      ...overrides
    };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value && !(key === "page" && value === "1")) query.set(key, value);
    }
    return `/repository${query.size ? `?${query.toString()}` : ""}`;
  };
  const listReturnTo = `${hrefFor({ page: String(currentPage) })}#word-list`;
  const accountHrefFor = (account: AccountDetailMode) => `/repository?account=${account}#account-details`;

  return (
    <main className="mn-repository-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "我的", href: "/me" },
          { label: "管理员中心" }
        ]}
      />

      <section className="mn-repository-container">
        <header className="mn-repository-hero">
          <div className="mn-repository-hero-copy">
            <p className="mn-repository-eyebrow">admin center</p>
            <h1 className="mn-repository-title">管理员中心</h1>
            <p className="mn-repository-description">
              当前列表：{scopeLabels[scope]}{scope === "missingCards" && selectedLevelCategory ? ` · ${selectedLevelCategory.label}` : ""}
            </p>
          </div>
          <div className="mn-repository-hero-meta" aria-label="管理员中心分页">
            <span>{totalCount.toLocaleString("zh-CN")} 词</span>
            {canUseAiExtensionReview ? <span>{aiExtensionReviewCount.toLocaleString("zh-CN")} 个 AI 延伸待审</span> : null}
            {canUseAiGeneratedWordCards ? <span>{aiGeneratedWordCardCount.toLocaleString("zh-CN")} 张 AI 生成单词卡</span> : null}
            {canUseAiExtensionReview ? <span>{labelArtifactCleanupWordIds.length.toLocaleString("zh-CN")} 个 OCR/逻辑词</span> : null}
            <span>第 {currentPage} / {totalPages} 页</span>
          </div>
        </header>

        <section className="mn-admin-overview" aria-label="后台数据概览">
          <AdminMetric
            label="账号总数"
            value={adminOverview.totalAccounts}
            detail={`${adminOverview.activeAccounts.toLocaleString("zh-CN")} 活跃 / ${adminOverview.suspendedAccounts.toLocaleString("zh-CN")} 停用`}
            href={accountHrefFor("all")}
            active={selectedAccountDetail === "all"}
          />
          <AdminMetric
            label="普通账号"
            value={adminOverview.userAccounts}
            detail={`后台账号 ${adminOverview.staffAccounts.toLocaleString("zh-CN")}`}
            href={accountHrefFor("ordinary")}
            active={selectedAccountDetail === "ordinary"}
          />
          <AdminMetric
            label="普通账号创卡"
            value={adminOverview.cardsCreatedByOrdinaryUsers}
            detail="未归档个人记忆卡"
            href={accountHrefFor("ordinaryCards")}
            active={selectedAccountDetail === "ordinaryCards"}
          />
          <AdminMetric
            label="待审核公开卡"
            value={adminOverview.pendingUserPublicCards}
            detail={`已公开 ${adminOverview.approvedUserPublicCards.toLocaleString("zh-CN")}`}
            href={accountHrefFor("pendingPublicCards")}
            active={selectedAccountDetail === "pendingPublicCards"}
          />
          <AdminMetric
            label="私有用户卡"
            value={adminOverview.privateUserCards}
            detail={`用户卡总数 ${adminOverview.allUserCards.toLocaleString("zh-CN")}`}
            href={accountHrefFor("privateUserCards")}
            active={selectedAccountDetail === "privateUserCards"}
          />
        </section>

        {accountDetails ? <AccountDetailsPanel details={accountDetails} /> : null}

        <section className="mn-word-card-stats" aria-label="单词卡统计">
          <WordCardStat
            label="缺失单词卡"
            value={wordCardStats.missingWordCount}
            detail="没有任何未归档记忆卡的单词"
            href={`${hrefFor({ q: "", sort: "az", view: "grid", reveal: "1", scope: "missingCards", level: "", page: "1" })}#word-list`}
            icon={<CircleAlert className="h-4 w-4" />}
          >
            <div className="mn-word-card-stat-links">
              {wordCardStats.levels.map((level) => (
                <Link
                  key={level.tag}
                  href={`${hrefFor({ q: "", sort: "az", view: "grid", reveal: "1", scope: "missingCards", level: level.slug, page: "1" })}#word-list`}
                  className={cn("mn-word-card-stat-level-link", selectedLevelCategory?.tag === level.tag && "is-active")}
                >
                  <span>{level.label}</span>
                  <span className="mn-word-card-stat-count">
                    {level.missingCount.toLocaleString("zh-CN")}/{level.totalCount.toLocaleString("zh-CN")}
                  </span>
                </Link>
              ))}
            </div>
          </WordCardStat>
          <WordCardStat
            label="已有单词卡"
            value={wordCardStats.withCardWordCount}
            detail={`覆盖单词数；共 ${wordCardStats.activeCardCount.toLocaleString("zh-CN")} 张未归档卡`}
            href={`${hrefFor({ q: "", sort: "az", view: "grid", reveal: "1", scope: "withCards", level: "", page: "1" })}#word-list`}
            icon={<BookOpenCheck className="h-4 w-4" />}
          />
          {canUseAiExtensionReview ? (
            <WordCardStat
              label="OCR/逻辑清理词包"
              value={labelArtifactCleanupWordIds.length}
              detail="glare 同批及相似逻辑复查"
              href={`${hrefFor({ q: "", sort: "az", view: "grid", reveal: "1", scope: labelArtifactCleanupScope, level: "", page: "1" })}#word-list`}
              icon={<BookOpenCheck className="h-4 w-4" />}
            />
          ) : null}
          {canUseAiExtensionReview ? (
            <WordCardStat
              label="AI延伸待审"
              value={aiExtensionReviewCount}
              detail="管理员试行的延伸生成草稿"
              href={`${hrefFor({ q: "", sort: "az", view: "grid", reveal: "1", scope: "aiExtensionReview", level: "", page: "1" })}#ai-extension-review`}
              icon={<Sparkles className="h-4 w-4" />}
            />
          ) : null}
          {canUseAiGeneratedWordCards ? (
            <WordCardStat
              label="AI生成单词卡"
              value={aiGeneratedWordCardCount}
              detail="独立生成，需审核后发布的草稿"
              href={`${hrefFor({ q: "", sort: "az", view: "grid", reveal: "1", scope: "aiGeneratedWordCards", level: "", page: "1" })}#ai-generated-word-cards`}
              icon={<Sparkles className="h-4 w-4" />}
            />
          ) : null}
        </section>

        {scope === "aiExtensionReview" && canUseAiExtensionReview ? (
          <AiExtensionReviewPanel
            items={aiExtensionReviewItems}
            totalCount={aiExtensionReviewCount}
            currentPage={currentPage}
            totalPages={totalPages}
            hrefForPage={(pageNumber) => `${hrefFor({ page: String(pageNumber) })}#ai-extension-review`}
            canEditOfficialCards={canEditOfficialCards}
            canExportMemoryCardImages={canExportMemoryCardImages}
          />
        ) : null}

        {scope === "aiGeneratedWordCards" && canUseAiGeneratedWordCards ? (
          <AiGeneratedWordCardPanel
            items={aiGeneratedWordCardItems}
            totalCount={aiGeneratedWordCardCount}
            currentPage={currentPage}
            totalPages={totalPages}
            hrefForPage={(pageNumber) => `${hrefFor({ page: String(pageNumber) })}#ai-generated-word-cards`}
          />
        ) : null}

        {!isSpecialDraftScope && deletedCount ? (
          <div className="mn-repository-notice">
            已删除 {deletedCount} 个单词。其他卡片数据保持不变。
          </div>
        ) : null}

        {!isSpecialDraftScope && removedFromPackCount ? (
          <div className="mn-repository-notice">
            已从词包移出 {removedFromPackCount} 个单词。单词和单词卡仍然保留。
          </div>
        ) : null}

        {!isSpecialDraftScope ? (
          <form className="mn-repository-toolbar" action="/repository">
            <RepositoryGlobalWordSearch
              initialQuery={initialGlobalSearchQuery}
              isAuthenticated={Boolean(user)}
              defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
              canEditOfficialCards={canEditOfficialCards}
              canExportMemoryCardImages={canExportMemoryCardImages}
            />
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="reveal" value={reveal ? "1" : ""} />
            <input type="hidden" name="level" value={activeLevelSlug} />
            <div className="mn-repository-control-row">
              <AutoSubmitSelect name="sort" defaultValue={sort} className="mn-repository-select">
                {Object.entries(sortLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </AutoSubmitSelect>
              <AutoSubmitSelect name="scope" defaultValue={scope} className="mn-repository-select">
                {Object.entries(availableScopeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </AutoSubmitSelect>
              <Button asChild variant={view === "grid" ? "default" : "ghost"} size="icon" className={cn("mn-repository-icon-button", view === "grid" && "is-active")}>
                <Link href={hrefFor({ view: "grid", page: "1" })} aria-label="网格视图">
                  <Grid2X2 className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant={view === "list" ? "default" : "ghost"} size="icon" className={cn("mn-repository-icon-button", view === "list" && "is-active")}>
                <Link href={hrefFor({ view: "list", page: "1" })} aria-label="列表视图">
                  <List className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant={reveal ? "default" : "ghost"} size="icon" className={cn("mn-repository-icon-button", reveal && "is-active")}>
                <Link href={hrefFor({ reveal: reveal ? "" : "1", page: "1" })} aria-label={reveal ? "隐藏释义与记忆方法" : "显示释义与记忆方法"}>
                  {reveal ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Link>
              </Button>
            </div>
          </form>
        ) : null}
      </section>

      {!isSpecialDraftScope ? (
        <section id="word-list" className="mn-repository-word-section">
          <RepositoryKeyboardController />
          {words.length === 0 ? (
            <div className="mn-repository-empty-state">
              没有找到卡片。可以换个关键词，或回到工作台新建单词。
            </div>
          ) : view === "grid" ? (
            <div className="mn-level-word-grid mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {words.map((word) => (
              <article
                key={word.id}
                data-repository-word-card="true"
                data-repository-word-id={word.id}
                data-repository-word-slug={word.slug}
                tabIndex={0}
                className="mn-level-word-card group relative flex min-h-44 appearance-none flex-col justify-between rounded-lg border border-[#d8dde6] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#171a1f] hover:shadow-sm focus:outline-none focus-visible:border-[#1a73e8] focus-visible:ring-2 focus-visible:ring-[#1a73e8] dark:border-border dark:bg-card dark:hover:border-foreground"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <WordCardPopupButton
                    slug={word.slug}
                    isAuthenticated={Boolean(user)}
                    defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
                    canEditOfficialCards={canEditOfficialCards}
                    canExportMemoryCardImages={canExportMemoryCardImages}
                    navigationSlugs={navigationSlugs}
                    ariaLabel={`打开 ${word.word} 单词卡弹窗`}
                    className="word-card-title min-w-0 hover:text-[var(--mn-accent)]"
                  >
                    <span className="block truncate">{word.word}</span>
                  </WordCardPopupButton>
                  <div className="flex shrink-0 items-center gap-1 opacity-45 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    {word.audioUsUrl || word.audioUkUrl ? (
                      <a
                        href={word.audioUsUrl || word.audioUkUrl || "#"}
                        className="mn-repository-row-icon"
                        aria-label={`播放 ${word.word}`}
                      >
                        <Volume2 className="h-4 w-4" />
                      </a>
                    ) : null}
                    <RepositoryDeleteButton
                      id={word.id}
                      word={word.word}
                      returnTo={listReturnTo}
                      mode={scope === labelArtifactCleanupScope ? "removeFromPack" : "delete"}
                      packScope={scope === labelArtifactCleanupScope ? labelArtifactCleanupScope : undefined}
                    />
                  </div>
                </div>
                <WordCardPopupButton
                  slug={word.slug}
                  isAuthenticated={Boolean(user)}
                  defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
                  canEditOfficialCards={canEditOfficialCards}
                  canExportMemoryCardImages={canExportMemoryCardImages}
                  navigationSlugs={navigationSlugs}
                  ariaLabel={`打开 ${word.word} 单词卡弹窗`}
                  className="word-card-meaning mt-6 block min-h-12 text-[#323741] dark:text-foreground/80"
                >
                  {reveal ? (
                    <span>
                      <span className="line-clamp-2">{word.shortMeaningCn || word.meaningCn || "未填写释义"}</span>
                    </span>
                  ) : (
                    <span>••••••</span>
                  )}
                </WordCardPopupButton>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#eef2f6] pt-3 text-xs font-semibold leading-5 text-[#69717f] dark:border-border dark:text-muted-foreground">
                  <span>{word._count.mnemonicEntries} 张卡</span>
                  <Badge className="mn-repository-status-badge">{word._count.mnemonicEntries ? "正文词" : "待补全"}</Badge>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <RepositoryBulkDeleteList
            words={words.map((word) => ({
              id: word.id,
              word: word.word,
              slug: word.slug,
              phonetic: word.phoneticUs || word.phoneticUk || "",
              meaning: reveal ? word.shortMeaningCn || word.meaningCn || "未填写释义" : "释义与带你背已隐藏",
              statusLabel: word._count.mnemonicEntries ? "正文" : "待补全"
            }))}
            returnTo={listReturnTo}
            bulkDeleteAction={scope === labelArtifactCleanupScope ? bulkRemoveWordsFromRepositoryPackAction : bulkDeleteWordsFromRepositoryAction}
            mode={scope === labelArtifactCleanupScope ? "removeFromPack" : "delete"}
            packScope={scope === labelArtifactCleanupScope ? labelArtifactCleanupScope : undefined}
            isAuthenticated={Boolean(user)}
            defaultUserCardVisibility={user?.defaultPublicMnemonics ? "public" : "private"}
            canEditOfficialCards={canEditOfficialCards}
            canExportMemoryCardImages={canExportMemoryCardImages}
          />
        )}
        {totalPages > 1 ? (
          <div className="mn-repository-pagination">
            <Button asChild variant="outline" className="mn-repository-page-button" aria-disabled={currentPage <= 1}>
              <Link href={currentPage <= 1 ? hrefFor({ page: "1" }) : hrefFor({ page: String(currentPage - 1) })}>上一页</Link>
            </Button>
            <span>
              第 {currentPage} / {totalPages} 页
            </span>
            <Button asChild variant="outline" className="mn-repository-page-button" aria-disabled={currentPage >= totalPages}>
              <Link href={currentPage >= totalPages ? hrefFor({ page: String(totalPages) }) : hrefFor({ page: String(currentPage + 1) })}>下一页</Link>
            </Button>
          </div>
        ) : null}
      </section>
      ) : null}
    </main>
  );
}

function AiExtensionReviewPanel({
  items,
  totalCount,
  currentPage,
  totalPages,
  hrefForPage,
  canEditOfficialCards,
  canExportMemoryCardImages
}: {
  items: Awaited<ReturnType<typeof getAiExtensionReviewItems>>;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hrefForPage: (pageNumber: number) => string;
  canEditOfficialCards: boolean;
  canExportMemoryCardImages: boolean;
}) {
  return (
    <section id="ai-extension-review" className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748b]">ai extension review</p>
          <h2 className="mt-1 text-xl font-semibold tracking-normal text-[#1d1d1f]">AI 单词延伸单词卡审核</h2>
        </div>
        <Badge className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
          {totalCount.toLocaleString("zh-CN")} 个待审
        </Badge>
      </div>
      {items.length ? (
        <>
          <AiExtensionReviewGrid
            canEditOfficialCards={canEditOfficialCards}
            canExportMemoryCardImages={canExportMemoryCardImages}
            items={items.map((item) => ({
              id: item.id,
              word: item.word,
              slug: item.slug,
              phonetic: item.phonetic,
              partOfSpeech: item.partOfSpeech,
              meaning: item.meaning,
              fullMeaning: item.fullMeaning,
              splitText: item.splitText,
              contentMarkdown: item.contentMarkdown,
              contentHtml: item.contentHtml,
              targetHasActiveCard: item.targetHasActiveCard,
              payload: {
                baseWord: item.payload.baseWord,
                targetWord: item.payload.targetWord,
                ruleLabel: item.payload.ruleLabel,
                confidence: item.payload.confidence,
                explanation: item.payload.explanation
              }
            }))}
          />
          {totalPages > 1 ? (
            <div className="mn-repository-pagination">
              <Button asChild variant="outline" className="mn-repository-page-button" aria-disabled={currentPage <= 1}>
                <Link href={currentPage <= 1 ? hrefForPage(1) : hrefForPage(currentPage - 1)}>上一页</Link>
              </Button>
              <span>
                第 {currentPage} / {totalPages} 页
              </span>
              <Button asChild variant="outline" className="mn-repository-page-button" aria-disabled={currentPage >= totalPages}>
                <Link href={currentPage >= totalPages ? hrefForPage(totalPages) : hrefForPage(currentPage + 1)}>下一页</Link>
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-6 text-sm font-medium text-[#64748b]">
          暂时没有 AI 延伸待审草稿。管理员在新 base word 的官方助记编辑器下方点击候选词后，会进入这里审核。
        </div>
      )}
    </section>
  );
}

function AiGeneratedWordCardPanel({
  items,
  totalCount,
  currentPage,
  totalPages,
  hrefForPage
}: {
  items: Awaited<ReturnType<typeof getAiGeneratedWordCardItems>>;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hrefForPage: (pageNumber: number) => string;
}) {
  return (
    <section id="ai-generated-word-cards" className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#64748b]">ai generated word cards</p>
          <h2 className="mt-1 text-xl font-semibold tracking-normal text-[#1d1d1f]">AI生成单词卡</h2>
        </div>
        <Badge className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
          {totalCount.toLocaleString("zh-CN")} 张待审核发布
        </Badge>
      </div>
      {items.length ? (
        <>
          <AiGeneratedWordCardGrid
            items={items.map((item) => ({
              id: item.id,
              word: item.word,
              slug: item.slug,
              phonetic: item.phonetic,
              partOfSpeech: item.partOfSpeech,
              meaning: item.meaning,
              fullMeaning: item.fullMeaning,
              splitText: item.splitText,
              contentMarkdown: item.contentMarkdown,
              contentHtml: item.contentHtml,
              imageUrl: item.imageUrl,
              targetHasActiveCard: item.targetHasActiveCard,
              payload: {
                methodLabel: item.payload.methodLabel,
                routeSummary: item.payload.routeSummary,
                confidence: item.payload.confidence
              }
            }))}
          />
          {totalPages > 1 ? (
            <div className="mn-repository-pagination">
              <Button asChild variant="outline" className="mn-repository-page-button" aria-disabled={currentPage <= 1}>
                <Link href={currentPage <= 1 ? hrefForPage(1) : hrefForPage(currentPage - 1)}>上一页</Link>
              </Button>
              <span>
                第 {currentPage} / {totalPages} 页
              </span>
              <Button asChild variant="outline" className="mn-repository-page-button" aria-disabled={currentPage >= totalPages}>
                <Link href={currentPage >= totalPages ? hrefForPage(totalPages) : hrefForPage(currentPage + 1)}>下一页</Link>
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-6 text-sm font-medium text-[#64748b]">
          暂时没有 AI 生成单词卡草稿。这里独立于 AI 延伸待审队列。
        </div>
      )}
    </section>
  );
}

function AdminMetric({
  label,
  value,
  detail,
  href,
  active = false
}: {
  label: string;
  value: number;
  detail: string;
  href?: string;
  active?: boolean;
}) {
  const content = (
    <>
      <span className="mn-admin-metric-label">{label}</span>
      <strong>{value.toLocaleString("zh-CN")}</strong>
      <span className="mn-admin-metric-detail">{detail}</span>
      {href ? (
        <span className="mn-admin-metric-link">
          <span>查看详情</span>
          <ArrowRight className="h-4 w-4" />
        </span>
      ) : null}
    </>
  );

  return href ? (
    <Link href={href} className={cn("mn-admin-metric", "is-clickable", active && "is-active")}>
      {content}
    </Link>
  ) : (
    <div className="mn-admin-metric">{content}</div>
  );
}

function AccountDetailsPanel({
  details
}: {
  details: Awaited<ReturnType<typeof getAdminAccountDetails>>;
}) {
  return (
    <section id="account-details" className="mn-account-details" aria-label={`${details.label}详情`}>
      <div className="mn-account-details-head">
        <div>
          <p className="mn-account-details-kicker">account details</p>
          <h2>{details.label}</h2>
        </div>
        <span>
          显示 {details.users.length.toLocaleString("zh-CN")} / {details.totalCount.toLocaleString("zh-CN")} 个
        </span>
      </div>
      {details.users.length ? (
        <div className="mn-account-table-wrap">
          <table className="mn-account-table">
            <thead>
              <tr>
                <th>账号</th>
                <th>身份</th>
                <th>记忆卡</th>
                <th>学习</th>
                <th>贡献</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {details.users.map((account) => (
                <tr key={account.id}>
                  <td>
                    <div className="mn-account-primary">{account.displayName}</div>
                    <div className="mn-account-secondary">{account.email}</div>
                    <div className="mn-account-secondary">@{account.username}</div>
                  </td>
                  <td>
                    <div className="mn-account-badge-row">
                      <span className="mn-account-badge">{roleLabel(account.role)}</span>
                      <span className={cn("mn-account-badge", account.status === "ACTIVE" ? "is-active" : "is-muted")}>
                        {account.status === "ACTIVE" ? "活跃" : "停用"}
                      </span>
                    </div>
                    <div className="mn-account-secondary">{account.defaultPublicMnemonics ? "默认公开" : "默认私有"}</div>
                  </td>
                  <td>
                    <div className="mn-account-count-line">个人卡 {account.activeUserCardCount.toLocaleString("zh-CN")}</div>
                    <div className="mn-account-secondary">
                      私有 {account.privateUserCardCount.toLocaleString("zh-CN")} · 待审 {account.pendingPublicCardCount.toLocaleString("zh-CN")} · 公开 {account.approvedPublicCardCount.toLocaleString("zh-CN")}
                    </div>
                  </td>
                  <td>
                    <div className="mn-account-count-line">标记 {account.wordMarkCount.toLocaleString("zh-CN")}</div>
                    <div className="mn-account-secondary">
                      复习卡 {account.reviewCardCount.toLocaleString("zh-CN")} · 复习 {account.reviewLogCount.toLocaleString("zh-CN")}
                    </div>
                  </td>
                  <td>
                    <div className="mn-account-count-line">通过 {account.wordCardContributionCount.toLocaleString("zh-CN")}</div>
                    <div className="mn-account-secondary">贡献分 {account.contributionScore.toLocaleString("zh-CN")}</div>
                  </td>
                  <td>
                    <div className="mn-account-count-line">{formatDate(account.createdAt)}</div>
                    <div className="mn-account-secondary">更新 {formatDate(account.updatedAt)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mn-repository-empty-state">这一类暂时没有账号。</div>
      )}
    </section>
  );
}

function WordCardStat({
  label,
  value,
  detail,
  href,
  icon,
  children
}: {
  label: string;
  value: number;
  detail: string;
  href: string;
  icon: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="mn-word-card-stat">
      <div className="mn-word-card-stat-main">
        <span className="mn-word-card-stat-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="mn-word-card-stat-label">{label}</span>
        <strong>{value.toLocaleString("zh-CN")}</strong>
        <span className="mn-word-card-stat-detail">{detail}</span>
        {children}
      </div>
      <Link href={href} className="mn-word-card-stat-link">
        <span>查看详情</span>
        <ArrowRight className="h-4 w-4" />
      </Link>
    </article>
  );
}

async function getAdminCenterOverview() {
  const [
    totalAccounts,
    activeAccounts,
    suspendedAccounts,
    userAccounts,
    staffAccounts,
    cardsCreatedByOrdinaryUsers,
    allUserCards,
    privateUserCards,
    pendingUserPublicCards,
    approvedUserPublicCards
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { status: "SUSPENDED" } }),
    prisma.user.count({ where: { role: UserRole.USER } }),
    prisma.user.count({ where: { role: { in: [UserRole.REVIEWER, UserRole.EDITOR, UserRole.ADMIN] } } }),
    prisma.mnemonicEntry.count({
      where: {
        sourceType: { not: MnemonicSourceType.OFFICIAL },
        status: { not: MnemonicStatus.ARCHIVED },
        author: { is: { role: UserRole.USER } }
      }
    }),
    prisma.mnemonicEntry.count({
      where: {
        sourceType: { not: MnemonicSourceType.OFFICIAL },
        status: { not: MnemonicStatus.ARCHIVED }
      }
    }),
    prisma.mnemonicEntry.count({
      where: {
        sourceType: MnemonicSourceType.USER_PRIVATE,
        status: { not: MnemonicStatus.ARCHIVED }
      }
    }),
    prisma.mnemonicEntry.count({
      where: {
        sourceType: MnemonicSourceType.USER_PUBLIC,
        status: MnemonicStatus.PENDING_REVIEW
      }
    }),
    prisma.mnemonicEntry.count({
      where: {
        sourceType: MnemonicSourceType.USER_PUBLIC,
        isPublic: true,
        status: { in: [MnemonicStatus.APPROVED, MnemonicStatus.FEATURED] }
      }
    })
  ]);

  return {
    totalAccounts,
    activeAccounts,
    suspendedAccounts,
    userAccounts,
    staffAccounts,
    cardsCreatedByOrdinaryUsers,
    allUserCards,
    privateUserCards,
    pendingUserPublicCards,
    approvedUserPublicCards
  };
}

async function getAdminAccountDetails(mode: AccountDetailMode) {
  const where = accountDetailWhere(mode);
  const [totalCount, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        role: true,
        status: true,
        defaultPublicMnemonics: true,
        contributionScore: true,
        wordCardContributionCount: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            reviewCards: true,
            reviewLogs: true,
            wordMarks: true
          }
        }
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200
    })
  ]);
  const userIds = users.map((account) => account.id);
  const [activeUserCards, privateUserCards, pendingPublicCards, approvedPublicCards] = await Promise.all([
    countMnemonicEntriesByAuthor(userIds, {
      sourceType: { not: MnemonicSourceType.OFFICIAL },
      status: { not: MnemonicStatus.ARCHIVED }
    }),
    countMnemonicEntriesByAuthor(userIds, {
      sourceType: MnemonicSourceType.USER_PRIVATE,
      status: { not: MnemonicStatus.ARCHIVED }
    }),
    countMnemonicEntriesByAuthor(userIds, {
      sourceType: MnemonicSourceType.USER_PUBLIC,
      status: MnemonicStatus.PENDING_REVIEW
    }),
    countMnemonicEntriesByAuthor(userIds, {
      sourceType: MnemonicSourceType.USER_PUBLIC,
      isPublic: true,
      status: { in: [MnemonicStatus.APPROVED, MnemonicStatus.FEATURED] }
    })
  ]);

  return {
    label: accountDetailLabels[mode],
    totalCount,
    users: users.map((account) => ({
      ...account,
      activeUserCardCount: activeUserCards.get(account.id) ?? 0,
      privateUserCardCount: privateUserCards.get(account.id) ?? 0,
      pendingPublicCardCount: pendingPublicCards.get(account.id) ?? 0,
      approvedPublicCardCount: approvedPublicCards.get(account.id) ?? 0,
      reviewCardCount: account._count.reviewCards,
      reviewLogCount: account._count.reviewLogs,
      wordMarkCount: account._count.wordMarks
    }))
  };
}

function accountDetailWhere(mode: AccountDetailMode): Prisma.UserWhereInput {
  if (mode === "ordinary") return { role: UserRole.USER };
  if (mode === "ordinaryCards") {
    return {
      role: UserRole.USER,
      mnemonicEntries: {
        some: {
          sourceType: { not: MnemonicSourceType.OFFICIAL },
          status: { not: MnemonicStatus.ARCHIVED }
        }
      }
    };
  }
  if (mode === "pendingPublicCards") {
    return {
      mnemonicEntries: {
        some: {
          sourceType: MnemonicSourceType.USER_PUBLIC,
          status: MnemonicStatus.PENDING_REVIEW
        }
      }
    };
  }
  if (mode === "privateUserCards") {
    return {
      mnemonicEntries: {
        some: {
          sourceType: MnemonicSourceType.USER_PRIVATE,
          status: { not: MnemonicStatus.ARCHIVED }
        }
      }
    };
  }
  return {};
}

async function countMnemonicEntriesByAuthor(userIds: string[], where: Prisma.MnemonicEntryWhereInput) {
  if (!userIds.length) return new Map<string, number>();
  const counts = await prisma.mnemonicEntry.groupBy({
    by: ["authorId"],
    where: {
      authorId: { in: userIds },
      ...where
    },
    _count: { _all: true }
  });
  return new Map(counts.map((item) => [item.authorId, item._count._all]));
}

async function getWordCardStats() {
  const [missingWordCount, withCardWordCount, activeCardCount, levels] = await Promise.all([
    prisma.word.count({ where: { mnemonicEntries: { none: activeMnemonicEntryWhere } } }),
    prisma.word.count({ where: { mnemonicEntries: { some: activeMnemonicEntryWhere } } }),
    prisma.mnemonicEntry.count({ where: activeMnemonicEntryWhere }),
    Promise.all(vocabCategories.map(getMissingCardLevelStat))
  ]);

  return {
    missingWordCount,
    withCardWordCount,
    activeCardCount,
    levels
  };
}

async function getMissingCardLevelStat(category: VocabCategory) {
  const levelWhere: Prisma.WordWhereInput = { levelTags: { has: category.tag } };
  const [missingCount, totalCount] = await Promise.all([
    prisma.word.count({
      where: {
        ...levelWhere,
        mnemonicEntries: { none: activeMnemonicEntryWhere }
      }
    }),
    prisma.word.count({ where: levelWhere })
  ]);

  return {
    tag: category.tag,
    slug: category.slug,
    label: category.shortLabel,
    missingCount,
    totalCount
  };
}

async function getLabelArtifactCleanupWordIds() {
  const [logs, exclusionLogs] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        action: labelArtifactCleanupAuditAction,
        entityType: "MnemonicEntry"
      },
      select: { metadataJson: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.auditLog.findMany({
      where: {
        action: labelArtifactCleanupPackExcludeAction,
        entityType: "Word"
      },
      select: { entityId: true }
    })
  ]);
  const excludedWordIds = new Set(exclusionLogs.map((log) => log.entityId));
  const cleanupWords = [
    ...new Set(
      [
        ...glareLikeLogicReviewWords,
        ...logs
          .map((log) => wordFromAuditMetadata(log.metadataJson))
          .filter((word): word is string => Boolean(word))
      ]
    )
  ];
  if (!cleanupWords.length) return [];
  const words = await prisma.word.findMany({
    where: { word: { in: cleanupWords } },
    select: { id: true }
  });
  return words.map((word) => word.id).filter((wordId) => !excludedWordIds.has(wordId));
}

function wordFromAuditMetadata(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const word = (metadata as Record<string, unknown>).word;
  return typeof word === "string" && word.trim() ? word.trim() : null;
}

function getRepositoryLevelCategory(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return vocabCategories.find((category) => category.slug === normalized || category.tag === (normalized as LevelTag)) ?? null;
}

function getAccountDetailMode(value: string | undefined): AccountDetailMode | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized in accountDetailLabels ? (normalized as AccountDetailMode) : null;
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    ADMIN: "管理员",
    EDITOR: "编辑",
    REVIEWER: "审核员",
    CONTRIBUTOR: "贡献者",
    USER: "用户"
  };
  return labels[role] ?? role;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
