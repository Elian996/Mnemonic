import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ModeDisplay = "block" | "contents" | "flex" | "grid" | "inline" | "inline-flex";

function modeDisplayStyle(display?: ModeDisplay): CSSProperties | undefined {
  if (!display) return undefined;
  return { "--mn-mode-display": display } as CSSProperties;
}

export function ResponsiveModeSwitch({
  desktop,
  desktopDisplay = "block",
  mobile,
  mobileDisplay = "block",
  className
}: {
  desktop: ReactNode;
  desktopDisplay?: ModeDisplay;
  mobile: ReactNode;
  mobileDisplay?: ModeDisplay;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mn-desktop-mode" style={modeDisplayStyle(desktopDisplay)}>
        {desktop}
      </div>
      <div className="mn-mobile-mode" style={modeDisplayStyle(mobileDisplay)}>
        {mobile}
      </div>
    </div>
  );
}

export function DesktopModeOnly({
  children,
  className,
  display = "block"
}: {
  children: ReactNode;
  className?: string;
  display?: ModeDisplay;
}) {
  return (
    <div className={cn("mn-desktop-mode", className)} style={modeDisplayStyle(display)}>
      {children}
    </div>
  );
}

export function MobileModeOnly({
  children,
  className,
  display = "block"
}: {
  children: ReactNode;
  className?: string;
  display?: ModeDisplay;
}) {
  return (
    <div className={cn("mn-mobile-mode", className)} style={modeDisplayStyle(display)}>
      {children}
    </div>
  );
}
