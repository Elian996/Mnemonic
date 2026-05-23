import type { Metadata } from "next";
import "./globals.css";
import { DeviceModeProvider } from "@/components/device-mode-provider";
import { GuestProgressSync } from "@/components/guest-progress-sync";
import { SiteHeader } from "@/components/site-header";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "mnemonic | 用词链记住英语单词",
  description: "一个面向中文学习者的英语单词助记、词链和记忆节点系统。"
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getLayoutSessionUser();

  return (
    <html lang="zh-CN" data-theme="system" suppressHydrationWarning>
      <body>
        <DeviceModeProvider>
          <SiteHeader initialTheme="system" showImports={user?.role === "ADMIN"} />
          <GuestProgressSync
            isAuthenticated={Boolean(user)}
            accountLabel={user?.displayName || user?.username || ""}
          />
          {children}
        </DeviceModeProvider>
      </body>
    </html>
  );
}

async function getLayoutSessionUser() {
  try {
    return await getSessionUser();
  } catch {
    return null;
  }
}
