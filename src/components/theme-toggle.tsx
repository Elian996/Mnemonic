"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Theme = "system" | "light" | "dark";

const themes: Theme[] = ["light", "dark", "system"];
const themeLabels: Record<Theme, string> = {
  light: "日间",
  dark: "夜间",
  system: "系统"
};
const themeIcons = {
  light: Sun,
  dark: Moon,
  system: Monitor
};

function applyTheme(theme: Theme) {
  const resolvedTheme = theme === "system" ? systemTheme() : theme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("theme", theme);
  document.cookie = `mnemonic_theme=${theme}; path=/; max-age=31536000; SameSite=Lax`;
}

function systemTheme(): Exclude<Theme, "system"> {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredTheme(fallback: Theme): Theme {
  const storageTheme = window.localStorage.getItem("theme");
  if (isTheme(storageTheme)) return storageTheme;

  const cookieTheme = document.cookie
    .split("; ")
    .find((item) => item.startsWith("mnemonic_theme="))
    ?.split("=")[1];
  return isTheme(cookieTheme) ? cookieTheme : fallback;
}

function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

export function ThemeToggle({
  className,
  initialTheme = "system",
  showLabel = false,
  variant = "button"
}: {
  className?: string;
  initialTheme?: Theme;
  showLabel?: boolean;
  variant?: "button" | "segmented";
}) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    const storedTheme = readStoredTheme(initialTheme);
    setTheme(storedTheme);
    applyTheme(storedTheme);
  }, [initialTheme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      const storedTheme = readStoredTheme(initialTheme);
      if (storedTheme === "system") applyTheme("system");
    };
    media.addEventListener("change", handleSystemThemeChange);
    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, [initialTheme]);

  const nextTheme = themes[(themes.indexOf(theme) + 1) % themes.length];
  const ActiveIcon = themeIcons[theme];
  const setNextTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  if (variant === "segmented") {
    return (
      <button
        type="button"
        className={cn("mn-theme-cycle-button", className)}
        aria-label={`当前主题：${themeLabels[theme]}，切换到${themeLabels[nextTheme]}`}
        title={`当前：${themeLabels[theme]}，点按切换到${themeLabels[nextTheme]}`}
        onClick={() => setNextTheme(nextTheme)}
      >
        <ActiveIcon aria-hidden />
        <span>{themeLabels[theme]}</span>
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      aria-label={`当前主题：${themeLabels[theme]}，切换到${themeLabels[nextTheme]}`}
      title={`切换到${themeLabels[nextTheme]}`}
      onClick={() => setNextTheme(nextTheme)}
      className={
        className ??
        (showLabel
          ? "h-10 rounded-md border border-[#d8dde6] bg-white px-3 text-sm font-semibold text-[#171a1f] hover:border-[#171a1f] hover:bg-white dark:border-border dark:bg-card dark:text-foreground dark:hover:border-foreground"
          : "h-9 w-9 rounded-md border border-[#d8dde6] bg-white text-[#171a1f] hover:border-[#171a1f] hover:bg-white dark:border-border dark:bg-card dark:text-foreground dark:hover:border-foreground")
      }
    >
      <ActiveIcon className="h-4 w-4" />
      {showLabel ? <span>{themeLabels[theme]}</span> : null}
    </Button>
  );
}
