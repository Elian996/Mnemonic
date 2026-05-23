import Link from "next/link";
import { ArrowLeft, CheckCheck, ExternalLink, Inbox } from "lucide-react";
import { PublicTopBar } from "@/components/public-top-bar";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/services/notification-service";
import { InteriorContainer, InteriorPage } from "@/components/interior-shell";

export default async function InboxPage() {
  const user = await requireUser();
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 80
  });
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <InteriorPage className="mn-profile-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "个人中心", href: "/me" },
          { label: "收件箱" }
        ]}
        themeVariant="segmented"
      />

      <InteriorContainer>
        <section className="mn-profile-subhero" aria-labelledby="inbox-title">
          <div className="mn-profile-subhero-copy">
            <p className="mn-profile-eyebrow">profile</p>
            <h1 id="inbox-title" className="mn-profile-subtitle-heading">
              <span className="mn-profile-heading-icon">
                <Inbox className="h-5 w-5" aria-hidden />
              </span>
              收件箱
            </h1>
            <p className="mn-profile-subcopy">公开记忆卡的审核结果会在这里提醒你。</p>
          </div>
          <div className="mn-profile-subhero-side">
            <span>{unreadCount.toLocaleString("zh-CN")} 条未读</span>
            <div className="mn-profile-subactions">
              <Link href="/me" className="mn-profile-back-link">
                <ArrowLeft className="h-4 w-4" aria-hidden />
                个人中心
              </Link>
              {unreadCount ? (
                <form action={markAllNotificationsReadAction}>
                  <Button type="submit" variant="outline" className="mn-profile-button">
                    <CheckCheck className="h-4 w-4" aria-hidden />
                    全部已读
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        </section>

        <div className="mn-profile-message-list">
          {notifications.map((notification) => (
            <section
              key={notification.id}
              className={`mn-profile-message-row ${notification.readAt ? "" : "is-unread"}`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {!notification.readAt ? (
                      <span className="mn-profile-pill">未读</span>
                    ) : null}
                    <h2 className="mn-profile-row-title">{notification.title}</h2>
                  </div>
                  <p className="mn-profile-row-copy mt-2 whitespace-pre-line">{notification.body}</p>
                  <p className="mt-3 text-xs text-[var(--mn-text-faint)]">
                    {formatDate(notification.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {notification.href ? (
                    <Button asChild variant="outline" size="sm" className="mn-profile-button">
                      <Link href={notification.href}>
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        查看
                      </Link>
                    </Button>
                  ) : null}
                  {!notification.readAt ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={notification.id} />
                      <Button type="submit" variant="secondary" size="sm" className="mn-profile-button">
                        已读
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>
            </section>
          ))}

          {!notifications.length ? (
            <div className="mn-profile-empty">
              还没有消息。之后公开记忆卡审核通过或失败，都会在这里提醒你。
            </div>
          ) : null}
        </div>
      </InteriorContainer>
    </InteriorPage>
  );
}

function formatDate(date: Date) {
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
