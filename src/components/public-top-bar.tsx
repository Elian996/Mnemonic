import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, LogOut, UserRound } from "lucide-react";
import { logoutAction } from "@/lib/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { MemoryCardFontToggle } from "@/components/memory-card-font-toggle";

type PublicUser = {
  displayName: string;
  username: string;
} | null;

type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function PublicTopBar({
  user,
  breadcrumbs,
  actionsSlot,
  rightSlot,
  showBackButton = true,
  themeVariant = "button"
}: {
  user: PublicUser;
  breadcrumbs: BreadcrumbItem[];
  actionsSlot?: ReactNode;
  rightSlot?: ReactNode;
  showBackButton?: boolean;
  themeVariant?: "button" | "segmented";
}) {
  const parentHref = [...breadcrumbs].slice(0, -1).reverse().find((item) => item.href)?.href;

  return (
    <header className="mn-topbar">
      <div className="flex min-w-0 items-center gap-2">
        {showBackButton && parentHref ? (
          <Link
            href={parentHref}
            aria-label="返回上级"
            title="返回上级"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] text-[var(--mn-muted)] transition hover:border-[var(--mn-ink)] hover:text-[var(--mn-ink)]"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        ) : null}
        <nav aria-label="页面位置" className="min-w-0 truncate text-xs font-bold text-[var(--mn-muted)]">
          {breadcrumbs.map((item, index) => (
            <span key={`${item.label}-${index}`}>
              {index > 0 ? <span className="mx-2 text-[var(--mn-line)]">/</span> : null}
              {item.href ? (
                <Link href={item.href} className="transition hover:text-[var(--mn-ink)]">
                  {item.label}
                </Link>
              ) : (
                <span className="text-[var(--mn-ink)]">{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {rightSlot}
        <div className="flex items-center gap-2">
          <ThemeToggle
            variant={themeVariant}
            className={themeVariant === "segmented" ? "mn-topbar-theme-segmented" : undefined}
          />
          <MemoryCardFontToggle />
          {actionsSlot}
          <Link
            href={user ? "/me" : "/login"}
            aria-label={user ? "个人中心" : "登录"}
            title={user ? "个人中心" : "登录"}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] text-[var(--mn-ink)] transition hover:border-[var(--mn-ink)]"
          >
            <UserRound className="h-4 w-4" />
          </Link>
          {user ? (
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label="退出登录"
                title="退出登录"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] text-[var(--mn-ink)] transition hover:border-[var(--mn-red)] hover:text-[var(--mn-red)]"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </header>
  );
}
