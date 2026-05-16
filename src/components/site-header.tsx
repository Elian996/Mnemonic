"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitBranch, Search, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandSearch } from "@/components/command-search";
import { LogoLockup } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader({
  initialTheme = "system",
  showImports = false
}: {
  initialTheme?: "system" | "light" | "dark";
  showImports?: boolean;
}) {
  const pathname = usePathname();

  if (
    pathname === "/" ||
    pathname === "/words" ||
    pathname.startsWith("/levels/") ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/me" ||
    pathname.startsWith("/me/")
  ) {
    return null;
  }

  const navItems = [
    { href: "/graph", label: "词链", icon: GitBranch },
    ...(showImports ? [{ href: "/imports", label: "导入", icon: UploadCloud }] : [])
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-[#d2cabd] bg-[#fffaf0]/90 text-[#13110e] backdrop-blur-xl dark:border-[#484036] dark:bg-[#191714]/90 dark:text-[#f5f1e8]">
      <div className="container flex h-[76px] items-center justify-between gap-4">
        <LogoLockup />
        <nav className="hidden items-center gap-1 text-sm font-bold text-[#3b352e] dark:text-[#c7bfb2] md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 transition hover:bg-[#ebe5da] hover:text-[#13110e] dark:hover:bg-[#24211d] dark:hover:text-[#f5f1e8]"
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <CommandSearch />
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 rounded-md text-[#3b352e] hover:bg-[#ebe5da] hover:text-[#13110e] dark:text-[#c7bfb2] dark:hover:bg-[#24211d] dark:hover:text-[#f5f1e8]">
            <Link href="/search">
              <Search className="h-4 w-4" />
            </Link>
          </Button>
          <ThemeToggle initialTheme={initialTheme} />
        </div>
      </div>
    </header>
  );
}
