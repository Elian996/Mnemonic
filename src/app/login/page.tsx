import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { loginAction, logoutAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { InteriorPage } from "@/components/interior-shell";
import { authUrlWithNext, pathFromReferer, safeInternalPath } from "@/lib/return-path";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const [user, sp, headerStore] = await Promise.all([getSessionUser(), searchParams, headers()]);
  const requestedNext = safeNextPath(sp.next);
  const refererPath = pathFromReferer(headerStore.get("referer"), headerStore.get("host"));
  const next = requestedNext || refererPath || "/me";
  const returnHref = requestedNext || refererPath || "/";
  const returnLabel = returnHref === "/" ? "首页" : "返回上级";
  const errorMessage = loginErrorMessage(sp.error);

  return (
    <InteriorPage>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href={returnHref} className="inline-flex items-center gap-2 text-xs font-bold text-[var(--mn-muted)] transition hover:text-[var(--mn-ink)]">
          {returnHref === "/" ? null : <ArrowLeft className="h-3.5 w-3.5" aria-hidden />}
          {returnLabel}
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href={authUrlWithNext("/register", next)} className="rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] px-3 py-2 text-sm font-semibold transition hover:border-[var(--mn-ink)]">
            注册
          </Link>
        </div>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-md items-center px-5 pb-16 sm:px-8">
        <div className="mn-panel w-full p-6">
          <p className="mn-kicker">account</p>
          <h1 className="mt-3 font-serif text-5xl font-semibold tracking-normal">登录</h1>
          {user ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-[var(--mn-line)] bg-[var(--mn-paper-deep)] px-3 py-2 text-sm text-[var(--mn-muted)]">
              <span className="min-w-0 truncate">当前账号：{user.displayName}</span>
              <form action={logoutAction}>
                <button type="submit" className="font-semibold text-[var(--mn-ink)] transition hover:text-[var(--mn-red)]">
                  退出
                </button>
              </form>
            </div>
          ) : null}
          <form action={loginAction} className="mt-6 grid gap-4">
            <input type="hidden" name="next" value={next} />
            <label className="grid gap-2 text-sm font-semibold text-[var(--mn-ink)]">
              邮箱
              <input
                name="email"
                type="email"
                placeholder="邮箱"
                autoComplete="email"
                required
                className="h-11 rounded-md border px-3 text-sm font-normal outline-none transition focus:border-[var(--mn-ink)]"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-[var(--mn-ink)]">
              密码
              <input
                name="password"
                type="password"
                placeholder="密码"
                autoComplete="current-password"
                required
                className="h-11 rounded-md border px-3 text-sm font-normal outline-none transition focus:border-[var(--mn-ink)]"
              />
            </label>
            <Link href="/forgot-password" className="text-sm font-semibold text-[var(--mn-muted)] transition hover:text-[var(--mn-ink)]">
              忘记密码？
            </Link>
            {errorMessage ? <p className="text-sm font-medium text-[var(--mn-red)]">{errorMessage}</p> : null}
            <button type="submit" className="h-11 rounded-md bg-[var(--mn-ink)] px-4 text-sm font-semibold text-[var(--mn-panel)] transition hover:opacity-90">
              登录
            </button>
          </form>
        </div>
      </section>
    </InteriorPage>
  );
}

function safeNextPath(value: string | undefined) {
  return safeInternalPath(value);
}

function loginErrorMessage(error: string | undefined) {
  if (error === "required") return "请先登录后再继续。";
  if (error === "suspended") return "这个账号已被停用。";
  if (error === "rate_limited") return "登录尝试太频繁，请稍后再试。";
  if (error === "invalid" || error === "1") return "邮箱或密码不正确。";
  return "";
}
