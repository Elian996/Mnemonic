import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { registerAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { InteriorPage } from "@/components/interior-shell";

export default async function RegisterPage({
  searchParams
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const [user, sp] = await Promise.all([getSessionUser(), searchParams]);
  if (user) redirect("/me");
  const errorMessage = registerErrorMessage(sp.error);
  const email = safeEmailParam(sp.email);

  return (
    <InteriorPage>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="text-xs font-bold text-[var(--mn-muted)] transition hover:text-[var(--mn-ink)]">
          首页
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login" className="rounded-md border border-[var(--mn-line)] bg-[var(--mn-panel)] px-3 py-2 text-sm font-semibold transition hover:border-[var(--mn-ink)]">
            登录
          </Link>
        </div>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-md items-center px-5 pb-16 sm:px-8">
        <div className="mn-panel w-full p-6">
          <p className="mn-kicker">account</p>
          <h1 className="mt-3 font-serif text-5xl font-semibold tracking-normal">注册</h1>
          <form action={registerAction} className="mt-6 grid gap-4">
            <label className="grid gap-2 text-sm font-semibold text-[var(--mn-ink)]">
              邮箱
              <input
                name="email"
                type="email"
                placeholder="邮箱"
                defaultValue={email}
                autoComplete="email"
                required
                className="h-11 rounded-md border px-3 text-sm font-normal outline-none transition focus:border-[var(--mn-ink)]"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-[var(--mn-ink)]">
              昵称
              <input
                name="displayName"
                placeholder="昵称"
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
                autoComplete="new-password"
                required
                className="h-11 rounded-md border px-3 text-sm font-normal outline-none transition focus:border-[var(--mn-ink)]"
              />
            </label>
            {errorMessage ? <p className="text-sm font-medium text-[var(--mn-red)]">{errorMessage}</p> : null}
            <button type="submit" className="h-11 rounded-md bg-[var(--mn-ink)] px-4 text-sm font-semibold text-[var(--mn-panel)] transition hover:opacity-90">
              注册
            </button>
          </form>
        </div>
      </section>
    </InteriorPage>
  );
}

function safeEmailParam(value: string | undefined) {
  return value && value.length <= 254 ? value : "";
}

function registerErrorMessage(error: string | undefined) {
  if (error === "duplicate") return "这个邮箱已经被注册。";
  if (error === "invalid_email") return "请先填写有效邮箱。";
  if (error === "invalid") return "请填写有效邮箱、昵称和至少 8 位密码。";
  return "";
}
