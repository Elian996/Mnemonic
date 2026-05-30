import { cn } from "@/lib/utils";

type LoadingLineProps = {
  label?: string;
  className?: string;
  trackClassName?: string;
};

export function LoadingLine({
  label = "正在加载",
  className,
  trackClassName
}: LoadingLineProps) {
  return (
    <div className={cn("mn-loading-line", className)} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <span className={cn("mn-loading-line-track", trackClassName)} aria-hidden="true">
        <span className="mn-loading-line-indicator" />
      </span>
    </div>
  );
}
