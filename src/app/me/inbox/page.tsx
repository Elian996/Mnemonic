import Link from "next/link";
import { ArrowLeft, CheckCheck, ExternalLink, Inbox } from "lucide-react";
import { PublicTopBar } from "@/components/public-top-bar";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/lib/services/notification-service";
import { InteriorContainer, InteriorHero, InteriorPage, InteriorPanel } from "@/components/interior-shell";

export default async function InboxPage() {
  const user = await requireUser();
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 80
  });
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <InteriorPage>
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "个人中心", href: "/me" },
          { label: "收件箱" }
        ]}
      />

      <InteriorContainer>
        <InteriorHero
          eyebrow="profile"
          title={
            <span className="inline-flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--mn-line)] text-[var(--mn-muted)]">
                <Inbox className="h-5 w-5" />
              </span>
              收件箱
            </span>
          }
          description="公开记忆卡的审核结果会在这里提醒你。"
          meta={`${unreadCount.toLocaleString("zh-CN")} 条未读`}
          actions={
            <>
              <Link href="/me" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--mn-muted)] transition hover:text-[var(--mn-ink)]">
                <ArrowLeft className="h-4 w-4" />
                个人中心
              </Link>
              {unreadCount ? (
                <form action={markAllNotificationsReadAction}>
                  <Button type="submit" variant="outline">
                    <CheckCheck className="h-4 w-4" />
                    全部已读
                  </Button>
                </form>
              ) : null}
            </>
          }
        />

        <div className="mt-8 space-y-3">
          {notifications.map((notification) => (
            <InteriorPanel
              key={notification.id}
              className={`p-5 ${notification.readAt ? "bg-[var(--mn-panel)]" : "border-[var(--mn-ink)]"}`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {!notification.readAt ? (
                      <span className="rounded-md bg-[var(--mn-ink)] px-2 py-0.5 text-xs font-semibold text-white">未读</span>
                    ) : null}
                    <h2 className="text-lg font-semibold">{notification.title}</h2>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--mn-muted)]">{notification.body}</p>
                  <p className="mt-3 text-xs text-[var(--mn-muted)]">{formatDate(notification.createdAt)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {notification.href ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={notification.href}>
                        <ExternalLink className="h-4 w-4" />
                        查看
                      </Link>
                    </Button>
                  ) : null}
                  {!notification.readAt ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={notification.id} />
                      <Button type="submit" variant="secondary" size="sm">
                        已读
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>
            </InteriorPanel>
          ))}

          {!notifications.length ? (
            <InteriorPanel className="p-6 text-sm text-[var(--mn-muted)]">
              还没有消息。之后公开记忆卡审核通过或失败，都会在这里提醒你。
            </InteriorPanel>
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
