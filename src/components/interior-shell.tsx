import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function InteriorPage({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return <main className={cn("mn-page", className)}>{children}</main>;
}

export function InteriorContainer({
  children,
  wide = false,
  className
}: {
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return <section className={cn("mn-container", wide && "mn-container-wide", className)}>{children}</section>;
}

export function InteriorHero({
  eyebrow = "mnemonic",
  title,
  description,
  meta,
  actions,
  children,
  className
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mn-hero", className)}>
      <div className="mn-hero-copy">
        <p className="mn-kicker">{eyebrow}</p>
        <h1 className="mn-title mt-4">{title}</h1>
        {description ? <div className="mn-subtitle mt-5">{description}</div> : null}
        {actions ? <div className="mt-6 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <aside className="hidden min-h-44 border-l border-[var(--mn-line)] pl-8 md:block">
        <div className="mn-kicker leading-7 text-[var(--mn-ink)]">
          WORDS.
          <br />
          CONNECT.
          <br />
          REMEMBER.
        </div>
        {meta ? <div className="mt-8 text-sm leading-7 text-[var(--mn-muted)]">{meta}</div> : null}
        <div className="mt-8 flex items-end justify-between gap-5">
          <div className="mn-dot-grid" aria-hidden />
          {children ? <div className="min-w-36 flex-1">{children}</div> : <div className="mn-cubist flex-1" aria-hidden />}
        </div>
      </aside>
    </div>
  );
}

export function InteriorPanel({
  children,
  className,
  dark = false
}: {
  children: ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return <section className={cn(dark ? "mn-panel mn-panel-dark" : "mn-panel", className)}>{children}</section>;
}
