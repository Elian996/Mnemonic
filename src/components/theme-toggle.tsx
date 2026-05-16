"use client";

import { useLayoutEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "system" | "light" | "dark";

function applyTheme(theme: Theme) {
  const resolvedTheme = theme === "system" ? systemTheme() : theme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("theme", theme);
  document.cookie = `mnemonic_theme=${theme}; path=/; max-age=31536000; SameSite=Lax`;
}

function isTheme(value: string | null | undefined): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

function systemTheme(): Exclude<Theme, "system"> {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function nextTheme(theme: Theme): Theme {
  if (theme === "system") return "light";
  if (theme === "light") return "dark";
  return "system";
}

export function ThemeToggle({ initialTheme = "system", showLabel = false }: { initialTheme?: Theme; showLabel?: boolean }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useLayoutEffect(() => {
    const htmlTheme = document.documentElement.dataset.theme;
    const stored = window.localStorage.getItem("theme");
    const currentTheme: Theme = isTheme(htmlTheme) ? htmlTheme : isTheme(stored) ? stored : "system";
    setTheme(currentTheme);
    applyTheme(currentTheme);
  }, []);

  useLayoutEffect(() => {
    if (theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => applyTheme("system");
    media.addEventListener("change", handleSystemThemeChange);
    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, [theme]);

  function toggleTheme() {
    const next = nextTheme(theme);
    setTheme(next);
    applyTheme(next);
  }

  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  const next = nextTheme(theme);
  const nextLabel = next === "system" ? "跟随系统" : next === "dark" ? "深色模式" : "浅色模式";
  const currentLabel = theme === "system" ? "系统" : theme === "dark" ? "夜览" : "正常";

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      aria-label={`切换到${nextLabel}`}
      title={`当前：${currentLabel}；切换到${nextLabel}`}
      onClick={toggleTheme}
      className={
        showLabel
          ? "h-10 rounded-md border border-[#d8dde6] bg-white px-3 text-sm font-semibold text-[#171a1f] hover:border-[#171a1f] hover:bg-white"
          : "h-9 w-9 rounded-md border border-[#d8dde6] bg-white text-[#171a1f] hover:border-[#171a1f] hover:bg-white dark:border-border dark:bg-card dark:text-foreground dark:hover:border-foreground"
      }
    >
      <Icon className="h-4 w-4" />
      {showLabel ? <span>{currentLabel}</span> : null}
    </Button>
  );
}
