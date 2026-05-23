"use client";

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { mobileModeMediaQuery, touchLikeMediaQuery, type DeviceMode } from "@/lib/device-mode";

type DeviceModeState = {
  mode: DeviceMode;
  isDesktop: boolean;
  isMobile: boolean;
  isReady: boolean;
  isTouchLike: boolean;
};

const defaultDeviceModeState: DeviceModeState = {
  mode: "desktop",
  isDesktop: true,
  isMobile: false,
  isReady: false,
  isTouchLike: false
};

const DeviceModeContext = createContext<DeviceModeState>(defaultDeviceModeState);

export function DeviceModeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DeviceModeState>(defaultDeviceModeState);

  useEffect(() => {
    const mobileQuery = window.matchMedia(mobileModeMediaQuery);
    const touchQuery = window.matchMedia(touchLikeMediaQuery);

    const updateDeviceMode = () => {
      const mode: DeviceMode = mobileQuery.matches ? "mobile" : "desktop";
      setState({
        mode,
        isDesktop: mode === "desktop",
        isMobile: mode === "mobile",
        isReady: true,
        isTouchLike: touchQuery.matches
      });
    };

    updateDeviceMode();
    mobileQuery.addEventListener("change", updateDeviceMode);
    touchQuery.addEventListener("change", updateDeviceMode);

    return () => {
      mobileQuery.removeEventListener("change", updateDeviceMode);
      touchQuery.removeEventListener("change", updateDeviceMode);
    };
  }, []);

  useEffect(() => {
    if (!state.isReady) return;

    document.documentElement.dataset.deviceMode = state.mode;
    document.documentElement.dataset.inputMode = state.isTouchLike ? "touch" : "pointer";
  }, [state.isReady, state.isTouchLike, state.mode]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyStoredTheme = () => {
      const storedTheme = readStoredTheme();
      const resolvedTheme = storedTheme === "system" ? (media.matches ? "dark" : "light") : storedTheme;
      document.documentElement.dataset.theme = storedTheme;
      document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
      window.localStorage.setItem("theme", storedTheme);
      document.cookie = `mnemonic_theme=${storedTheme}; path=/; max-age=31536000; SameSite=Lax`;
    };

    applyStoredTheme();
    media.addEventListener("change", applyStoredTheme);
    return () => media.removeEventListener("change", applyStoredTheme);
  }, []);

  const value = useMemo(() => state, [state]);

  return <DeviceModeContext.Provider value={value}>{children}</DeviceModeContext.Provider>;
}

export function useDeviceMode() {
  return useContext(DeviceModeContext);
}

export function DeviceModeView({
  children,
  fallback = null,
  mode
}: {
  children: ReactNode;
  fallback?: ReactNode;
  mode: DeviceMode;
}) {
  const device = useDeviceMode();
  if (!device.isReady) return <>{fallback}</>;
  return device.mode === mode ? <>{children}</> : null;
}

function readStoredTheme() {
  const storageTheme = window.localStorage.getItem("theme");
  if (isTheme(storageTheme)) return storageTheme;

  const cookieTheme = document.cookie
    .split("; ")
    .find((item) => item.startsWith("mnemonic_theme="))
    ?.split("=")[1];
  return isTheme(cookieTheme) ? cookieTheme : "system";
}

function isTheme(value: unknown): value is "system" | "light" | "dark" {
  return value === "system" || value === "light" || value === "dark";
}
