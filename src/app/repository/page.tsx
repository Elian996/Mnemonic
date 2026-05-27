import Link from "next/link";
import { Eye, EyeOff, Grid2X2, List, ListChecks, Volume2, Wrench } from "lucide-react";
import { MnemonicSourceType, MnemonicStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { hasRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RepositoryBulkDeleteList } from "@/components/repository-bulk-delete-list";
import { RepositoryDeleteButton } from "@/components/repository-delete-button";
import { RepositoryKeyboardController } from "@/components/repository-keyboard-controller";
import { RepositoryReviewPassButton } from "@/components/repository-review-pass-button";
import { RepositoryGlobalWordSearch } from "@/components/repository-global-word-search";
import { WordCardPopupButton } from "@/components/word-card-popup-button";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { PublicTopBar } from "@/components/public-top-bar";
import { bulkDeleteWordsFromRepositoryAction } from "@/lib/services/word-service";
import { repositoryReviewPassActionForScope } from "@/lib/repository-review";

export const dynamic = "force-dynamic";

type RepositorySearchParams = {
  q?: string;
  sort?: string;
  view?: string;
  reveal?: string;
  scope?: string;
  letter?: string;
  level?: string;
  page?: string;
  deleted?: string;
};

const pageSize = 120;
const pdfSourceManualReviewAction = "PDF_SOURCE_CARD_FILL_MANUAL_REVIEW";
const linkCycleRescueReviewAction = "MNEMONIC_LINK_CYCLE_RESCUE_REVIEW";
const linkCycleRescueDoneAction = "MNEMONIC_LINK_CYCLE_RESCUE_DONE";

const sortLabels: Record<string, string> = {
  recent: "最近添加",
  oldest: "最早添加",
  az: "按字母 A-Z",
  za: "按字母 Z-A"
};

const scopeLabels: Record<string, string> = {
  linkCycleRescue: "待救援",
  linkCycleRestored: "已修复",
  pdfManual: "PDF人工"
};
const defaultRepositoryScope = "linkCycleRescue";

export default async function RepositoryPage({
  searchParams
}: {
  searchParams: Promise<RepositorySearchParams>;
}) {
  const params = await searchParams;
  const initialGlobalSearchQuery = params.q?.trim() ?? "";
  const sort = sortLabels[params.sort ?? ""] ? String(params.sort) : "az";
  const view = params.view === "list" ? "list" : "grid";
  const reveal = params.reveal === "1";
  const scope = scopeLabels[params.scope ?? ""] ? String(params.scope) : defaultRepositoryScope;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const deletedCount = Math.max(0, Number.parseInt(params.deleted ?? "0", 10) || 0);
  const user = await requireRole(UserRole.REVIEWER);
  const canEditOfficialCards = hasRole(user, UserRole.EDITOR);
  const canExportMemoryCardImages = hasRole(user, UserRole.ADMIN);
  const pdfSourceManualReviewWordIds = await getPdfSourceManualReviewWordIds();
  const pdfSourceManualReviewCount = pdfSourceManualReviewWordIds.length;
  const linkCycleRescueWordIds = await getLinkCycleRescueWordIds();
  const linkCycleRescueCount = linkCycleRescueWordIds.length;
  const linkCycleRestoredWordIds = await getLinkCycleRestoredWordIds();
  const linkCycleRestoredCount = linkCycleRestoredWordIds.length;
  const adminOverview = await getAdminCenterOverview();

  const baseWhere = (): Prisma.WordWhereInput => ({
    AND: [
      scope === "linkCycleRestored" ? { id: { in: linkCycleRestoredWordIds } } : {},
      scope === "pdfManual" ? { id: { in: pdfSourceManualReviewWordIds } } : {},
      scope === "linkCycleRescue" ? { id: { in: linkCycleRescueWordIds } } : {}
    ]
  });
  const where = baseWhere();

  const orderBy =
    sort === "oldest"
      ? { createdAt: "asc" as const }
      : sort === "az"
        ? { word: "asc" as const }
        : sort === "za"
          ? { word: "desc" as const }
          : { createdAt: "desc" as const };

  const totalCount = await prisma.word.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page, totalPages);
  const words = await prisma.word.findMany({
    where,
    include: {
      _count: {
        select: { mnemonicEntries: { where: { status: { not: "ARCHIVED" } } } }
      },
      mnemonicEntries: {
        where: { status: { not: "ARCHIVED" } },
        orderBy: [{ sourceType: "asc" }, { updatedAt: "desc" }],
        take: 1
      }
    },
    orderBy,
    skip: (currentPage - 1) * pageSize,
    take: pageSize
  });
  const navigationSlugs = words.map((word) => word.slug);
  const reviewPassAction = repositoryReviewPassActionForScope(scope);
  const reviewPassLogs =
    user && reviewPassAction && words.length
      ? await prisma.auditLog.findMany({
          where: {
            actorId: user.id,
            action: reviewPassAction,
            entityType: "Word",
            entityId: { in: words.map((word) => word.id) }
          },
          select: { entityId: true }
        })
      : [];
  const reviewPassedWordIds = new Set(reviewPassLogs.map((log) => log.entityId));

  const hrefFor = (overrides: Partial<RepositorySearchParams>) => {
    const next = { sort, view, reveal: reveal ? "1" : "", scope, page: String(currentPage), ...overrides };
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value && !(key === "page" && value === "1")) query.set(key, value);
    }
    return `/repository${query.size ? `?${query.toString()}` : ""}`;
  };
  const listReturnTo = `${hrefFor({ page: String(currentPage) })}#word-list`;

  return (
    <main className="mn-repository-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "我的", href: "/me" },
          { label: "管理员中心" }
        ]}
        actionsSlot={
          <>
            <Link
              href={`${hrefFor({ q: "", sort: "az", view: "grid", reveal: "1", scope: "linkCycleRescue", page: "1" })}#word-list`}
              className="mn-repository-top-action"
            >
              <Wrench className="h-4 w-4" />
              <span>待救援</span>
              <span className="mn-repository-top-count">{linkCycleRescueCount.toLocaleString("zh-CN")}</span>
            </Link>
            <Link
              href={`${hrefFor({ q: "", sort: "az", view: "grid", reveal: "1", scope: "linkCycleRestored", page: "1" })}#word-list`}
              className="mn-repository-top-action"
            >
              <ListChecks className="h-4 w-4" />
              <span>已修复</span>
              <span className="mn-repository-top-count">{linkCycleRestoredCount.toLocaleString("zh-CN")}</span>
            </Link>
            <Link
              href={`${hrefFor({ q: "", sort: "az", view: "grid", reveal: "1", scope: "pdfManual", page: "1" })}#word-list`}
              className="mn-repository-top-action"
            >
              <ListChecks className="h-4 w-4" />
              <span>PDF人工</span>
              <span className="mn-repository-top-count">{pdfSourceManualReviewCount.toLocaleString("zh-CN")}</span>
            </Link>
          </>
        }
      />

      <section className="mn-repository-container">
        <header className="mn-repository-hero">
          <div className="mn-repository-hero-copy">
            <p className="mn-repository-eyebrow">admin center</p>
            <h1 className="mn-repository-title">管理员中心</h1>
            <p className="mn-repository-description">
              当前工作堆：{scopeLabels[scope]}
            </p>
          </div>
          <div className="mn-repository-hero-meta" aria-label="管理员中心分页">
            <span>{totalCount.toLocaleString("zh-CN")} 词</span>
            <span>第 {currentPage} / {totalPages} 页</span>
          </div>
        </header>

        <section className="mn-admin-overview" aria-label="后台数据概览">
          <AdminMetric
            label="账号总数"
            value={adminOverview.totalAccounts}
            detail={`${adminOverview.activeAccounts.toLocaleString("zh-CN")} 活跃 / ${adminOverview.suspendedAccounts.toLocaleString("zh-CN")} 停用`}
          />
          <AdminMetric
            label="普通账号"
            value={adminOverview.userAccounts}
            detail={`后台账号 ${adminOverview.staffAccounts.toLocaleString("zh-CN")}`}
          />
          <AdminMetric
            label="普通账号创卡"
            value={adminOverview.cardsCreatedByOrdinaryUsers}
            detail="未归档个人记忆卡"
          />
          <AdminMetric
            label="待审核公开卡"
            value={adminOverview.pendingUserPublicCards}
            detail={`已公开 ${adminOverview.approvedUserPublicCards.toLocaleString("zh-CN")}`}
          />
          <AdminMetric
            label="私有用户卡"
            value={adminOverview.privateUserCards}
            detail={`用户卡总数 ${adminOverview.allUserCards.toLocaleString("zh-CN")}`}
          />
        </section>

        {deletedCount ? (
          <div className="mn-repository-notice">
            已删除 {deletedCount} 个单词。其他卡片数据保持不变。
          </div>
        ) : null}

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
          <div className="mn-repository-control-row">
            <AutoSubmitSelect name="sort" defaultValue={sort} className="mn-repository-select">
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </AutoSubmitSelect>
            <AutoSubmitSelect name="scope" defaultValue={scope} className="mn-repository-select">
              {Object.entries(scopeLabels).map(([value, label]) => (
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
      </section>

      <section id="word-list" className="mn-repository-word-section">
        <RepositoryKeyboardController />
        {words.length === 0 ? (
          <div className="mn-repository-empty-state">
            没有找到卡片。可以换个关键词，或回到工作台新建单词。
          </div>
        ) : view === "grid" ? (
          <div className="mn-repository-word-grid">
            {words.map((word) => (
              <article
                key={word.id}
                data-repository-word-card="true"
                data-repository-word-id={word.id}
                data-repository-word-slug={word.slug}
                data-review-passed={reviewPassedWordIds.has(word.id) ? "true" : "false"}
                tabIndex={0}
                className={cn(
                  "mn-repository-word-card",
                  reviewPassedWordIds.has(word.id) && "is-review-passed"
                )}
              >
                <div className="mn-repository-word-card-head">
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
                  <div className="mn-repository-word-actions">
                    <RepositoryReviewPassButton
                      wordId={word.id}
                      word={word.word}
                      scope={scope}
                      initialPassed={reviewPassedWordIds.has(word.id)}
                    />
                    {word.audioUsUrl || word.audioUkUrl ? (
                      <a
                        href={word.audioUsUrl || word.audioUkUrl || "#"}
                        className="mn-repository-row-icon"
                        aria-label={`播放 ${word.word}`}
                      >
                        <Volume2 className="h-4 w-4" />
                      </a>
                    ) : null}
                    <RepositoryDeleteButton id={word.id} word={word.word} />
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
                  className="mn-repository-word-preview"
                >
                  {reveal ? (
                    <span>
                      <span className="line-clamp-2">{word.shortMeaningCn || word.meaningCn || "未填写释义"}</span>
                      <span className="mt-2 line-clamp-2 text-xs text-[var(--mn-text-faint)]">{word.mnemonicEntries[0]?.splitText || word.mnemonicEntries[0]?.plainText || "还没有记忆方法"}</span>
                    </span>
                  ) : (
                    <span className="mn-repository-hidden-line">已隐藏释义</span>
                  )}
                </WordCardPopupButton>
                <div className="mn-repository-word-card-foot">
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
            bulkDeleteAction={bulkDeleteWordsFromRepositoryAction}
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
    </main>
  );
}

function AdminMetric({
  label,
  value,
  detail
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="mn-admin-metric">
      <span className="mn-admin-metric-label">{label}</span>
      <strong>{value.toLocaleString("zh-CN")}</strong>
      <span className="mn-admin-metric-detail">{detail}</span>
    </div>
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

async function getPdfSourceManualReviewWordIds() {
  const logs = await prisma.auditLog.findMany({
    where: {
      action: pdfSourceManualReviewAction,
      entityType: "Word"
    },
    select: { entityId: true },
    orderBy: { createdAt: "asc" }
  });
  return [...new Set(logs.map((log) => log.entityId))];
}

async function getLinkCycleRescueWordIds() {
  const [reviewLogs, doneLogs] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        action: linkCycleRescueReviewAction,
        entityType: "Word"
      },
      select: { entityId: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.auditLog.findMany({
      where: {
        action: linkCycleRescueDoneAction,
        entityType: "Word"
      },
      select: { entityId: true }
    })
  ]);
  const doneWordIds = new Set(doneLogs.map((log) => log.entityId));
  return [...new Set(reviewLogs.map((log) => log.entityId).filter((id) => !doneWordIds.has(id)))];
}

async function getLinkCycleRestoredWordIds() {
  const logs = await prisma.auditLog.findMany({
    where: {
      action: linkCycleRescueDoneAction,
      entityType: "Word"
    },
    select: { entityId: true },
    orderBy: { createdAt: "asc" }
  });
  return [...new Set(logs.map((log) => log.entityId))];
}
