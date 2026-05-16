import Link from "next/link";
import { BookMarked, BookOpenCheck, Check, Circle, ExternalLink, Inbox, X, type LucideIcon } from "lucide-react";
import { MnemonicSourceType, MnemonicStatus } from "@prisma/client";
import { PublicTopBar } from "@/components/public-top-bar";
import { getSessionUser, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { canReviewSubmissions } from "@/lib/permissions";
import { InteriorContainer, InteriorHero, InteriorPage, InteriorPanel } from "@/components/interior-shell";

export default async function MePage() {
  const sessionUser = await getSessionUser();
  const user = sessionUser ?? (await requireUser());

  const canReview = canReviewSubmissions(user);
  const [markCounts, unreadNotificationCount, myMnemonicCount, pendingUserSubmissionCount] = await Promise.all([
    prisma.wordMark.groupBy({
      by: ["state"],
      where: { userId: user.id },
      _count: { _all: true }
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.mnemonicEntry.count({
      where: {
        authorId: user.id,
        sourceType: { not: MnemonicSourceType.OFFICIAL },
        status: { not: MnemonicStatus.ARCHIVED }
      }
    }),
    canReview
      ? prisma.mnemonicEntry.count({
          where: {
            sourceType: MnemonicSourceType.USER_PUBLIC,
            status: MnemonicStatus.PENDING_REVIEW
          }
        })
      : Promise.resolve(0)
  ]);

  const markCountByState = Object.fromEntries(markCounts.map((item) => [item.state, item._count._all]));
  const modules = [
    {
      key: "known" as const,
      label: "熟练",
      value: markCountByState.KNOWN ?? 0,
      icon: Check
    },
    {
      key: "fuzzy" as const,
      label: "模糊",
      value: markCountByState.FUZZY ?? 0,
      icon: Circle
    },
    {
      key: "unknown" as const,
      label: "生词本",
      value: markCountByState.UNKNOWN ?? 0,
      icon: X
    },
    {
      key: "mnemonics" as const,
      label: "管理我的记忆卡",
      value: myMnemonicCount,
      icon: BookOpenCheck
    },
    {
      key: "inbox" as const,
      label: "收件箱",
      value: unreadNotificationCount,
      icon: Inbox
    }
  ];
  const adminModules = canReview
    ? [
        {
          key: "user-submissions" as const,
          label: "用户创作记忆卡",
          value: pendingUserSubmissionCount,
          icon: BookMarked
        }
      ]
    : [];

  return (
    <InteriorPage>
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "个人中心" }
        ]}
      />

      <InteriorContainer>
        <InteriorHero
          eyebrow="profile"
          title={user.displayName}
          description={`@${user.username}`}
          meta="个人中心"
          actions={
            <Link
              href={`/profile/${user.username}`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] px-4 text-sm font-semibold transition hover:border-[var(--mn-ink)]"
            >
              <ExternalLink className="h-4 w-4" />
              公开主页
            </Link>
          }
        />
        <InteriorPanel className="mt-8 flex flex-col gap-5 p-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-serif text-3xl font-semibold">学习状态</h2>
            <p className="mt-2 text-sm text-[var(--mn-muted)]">把熟练、模糊和生词分开收纳，后续复习会更清楚。</p>
          </div>
        </InteriorPanel>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[...modules, ...adminModules].map((module) => (
            <ModuleCard key={module.key} href={`/me/${module.key}`} label={module.label} value={module.value} icon={module.icon} />
          ))}
        </div>
      </InteriorContainer>
    </InteriorPage>
  );
}

function ModuleCard({
  href,
  label,
  value,
  icon: Icon
}: {
  href: string;
  label: string;
  value: number;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="mn-link-card flex min-h-32 flex-col justify-between p-5"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-lg font-semibold">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--mn-line)] text-[var(--mn-muted)]">
          <Icon className="h-4 w-4" />
        </span>
      </span>
      <span className="text-3xl font-semibold">{value.toLocaleString("zh-CN")}</span>
    </Link>
  );
}
