import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { GuestProgressSync } from "@/components/guest-progress-sync";
import { SiteHeader } from "@/components/site-header";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "mnemonic | 用词链记住英语单词",
  description: "一个面向中文学习者的英语单词助记、词链和记忆节点系统。"
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const themeCookie = (await cookies()).get("mnemonic_theme")?.value;
  const theme = themeCookie === "system" || themeCookie === "light" || themeCookie === "dark" ? themeCookie : "system";
  const user = await getSessionUser();

  return (
    <html lang="zh-CN" className={theme === "dark" ? "dark" : undefined} data-theme={theme} suppressHydrationWarning>
      <body>
        <SiteHeader initialTheme={theme} showImports={user?.role === "ADMIN"} />
        <GuestProgressSync isAuthenticated={Boolean(user)} accountLabel={user?.displayName || user?.username || ""} />
        {children}
      </body>
    </html>
  );
}
