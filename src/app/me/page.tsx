import Link from "next/link";
import {
  ArrowRight,
  BookMarked,
  BookOpenCheck,
  Check,
  Circle,
  Database,
  Inbox,
  X,
  type LucideIcon
} from "lucide-react";
import { MnemonicSourceType, MnemonicStatus } from "@prisma/client";
import { PublicTopBar } from "@/components/public-top-bar";
import { getSessionUser, requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { canReviewSubmissions } from "@/lib/permissions";
import { InteriorContainer, InteriorPage } from "@/components/interior-shell";

export default async function MePage() {
  const sessionUser = await getSessionUser();
  const user = sessionUser ?? (await requireUser());

  const canReview = canReviewSubmissions(user);
  const canUseRepository = canReview;
  const [
    markCounts,
    unreadNotificationCount,
    myMnemonicCount,
    pendingUserSubmissionCount,
    totalAccountCount
  ] = await Promise.all([
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
      : Promise.resolve(0),
    canUseRepository ? prisma.user.count() : Promise.resolve(0)
  ]);

  const markCountByState = Object.fromEntries(
    markCounts.map((item) => [item.state, item._count._all])
  );
  const learningModules = [
    {
      key: "known" as const,
      href: "/me/known",
      label: "熟练",
      value: markCountByState.KNOWN ?? 0,
      icon: Check
    },
    {
      key: "fuzzy" as const,
      href: "/me/fuzzy",
      label: "模糊",
      value: markCountByState.FUZZY ?? 0,
      icon: Circle
    },
    {
      key: "unknown" as const,
      href: "/me/unknown",
      label: "生词本",
      value: markCountByState.UNKNOWN ?? 0,
      icon: X
    }
  ];
  const directoryModules = [
    {
      key: "mnemonics" as const,
      href: "/me/mnemonics",
      label: "管理我的记忆卡",
      value: myMnemonicCount,
      icon: BookOpenCheck
    },
    {
      key: "inbox" as const,
      href: "/me/inbox",
      label: "收件箱",
      value: unreadNotificationCount,
      icon: Inbox
    }
  ];
  const adminModules = [
    ...(canUseRepository
      ? [
          {
            key: "repository" as const,
            href: "/repository",
            label: "管理员中心",
            value: totalAccountCount,
            icon: Database,
            prefetch: false,
            mobileHidden: true
          }
        ]
      : []),
    ...(canReview
      ? [
          {
            key: "user-submissions" as const,
            href: "/me/user-submissions",
            label: "用户创作记忆卡",
            value: pendingUserSubmissionCount,
            icon: BookMarked,
            mobileHidden: true
          }
        ]
      : [])
  ];

  return (
    <InteriorPage className="mn-profile-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[{ label: "首页", href: "/" }, { label: "我的" }]}
        themeVariant="segmented"
      />

      <InteriorContainer className="mn-profile-container">
        <section className="mn-profile-identity" aria-labelledby="me-title">
          <div className="min-w-0">
            <p className="mn-profile-eyebrow">profile</p>
            <h1 id="me-title" className="mn-profile-title">
              {user.displayName}
            </h1>
            <p className="mn-profile-handle">
              @{user.username} · 单词卡贡献 {user.wordCardContributionCount.toLocaleString("zh-CN")}
            </p>
          </div>
        </section>

        <section className="mn-profile-status-strip" aria-label="学习状态">
          {learningModules.map((module) => (
            <StatusLink
              key={module.key}
              href={module.href}
              label={module.label}
              value={module.value}
              icon={module.icon}
            />
          ))}
        </section>

        <section className="mn-profile-directory" aria-labelledby="profile-directory-title">
          <div className="mn-profile-section-head">
            <p id="profile-directory-title">个人目录</p>
          </div>
          <div className="mn-profile-directory-list">
            {[...directoryModules, ...adminModules].map((module) => (
              <DirectoryLink
                key={module.key}
                href={module.href}
                label={module.label}
                value={module.value}
                icon={module.icon}
                prefetch={"prefetch" in module ? module.prefetch : undefined}
                hideOnMobile={"mobileHidden" in module ? module.mobileHidden : undefined}
              />
            ))}
          </div>
        </section>
      </InteriorContainer>
    </InteriorPage>
  );
}

function StatusLink({
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
    <Link href={href} className="mn-profile-status-item">
      <span className="mn-profile-status-icon">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="mn-profile-status-copy">
        <span>{label}</span>
        <strong>{value.toLocaleString("zh-CN")}</strong>
      </span>
      <ArrowRight className="mn-profile-row-arrow h-4 w-4" aria-hidden />
    </Link>
  );
}

function DirectoryLink({
  href,
  label,
  value,
  icon: Icon,
  prefetch,
  hideOnMobile
}: {
  href: string;
  label: string;
  value: number;
  icon: LucideIcon;
  prefetch?: boolean;
  hideOnMobile?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={`mn-profile-directory-row${hideOnMobile ? " mn-profile-directory-row-mobile-hidden" : ""}`}
    >
      <span className="mn-profile-directory-main">
        <span className="mn-profile-directory-icon">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span>{label}</span>
      </span>
      <span className="mn-profile-directory-meta">
        {value.toLocaleString("zh-CN")}
        <ArrowRight className="mn-profile-row-arrow h-4 w-4" aria-hidden />
      </span>
    </Link>
  );
}
