import type { Metadata } from "next";
import { cookies } from "next/headers";
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

type Theme = "system" | "light" | "dark";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, initialTheme] = await Promise.all([getLayoutSessionUser(), getInitialTheme()]);

  return (
    <html
      lang="zh-CN"
      data-theme={initialTheme}
      className={initialTheme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <body>
        <DeviceModeProvider>
          <SiteHeader initialTheme={initialTheme} showImports={user?.role === "ADMIN"} />
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

async function getInitialTheme(): Promise<Theme> {
  try {
    const theme = (await cookies()).get("mnemonic_theme")?.value;
    return isTheme(theme) ? theme : "system";
  } catch {
    return "system";
  }
}

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}
