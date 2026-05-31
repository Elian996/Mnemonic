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

export function InlineLoadingLine({
  label = "正在加载",
  className,
  trackClassName
}: LoadingLineProps) {
  return (
    <span className={cn("mn-loading-line", className)} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <span className={cn("mn-loading-line-track", trackClassName)} aria-hidden="true">
        <span className="mn-loading-line-indicator" />
      </span>
    </span>
  );
}

type LoadingBoxProps = LoadingLineProps & {
  description?: string;
};

export function LoadingBox({
  label = "正在加载",
  description,
  className,
  trackClassName
}: LoadingBoxProps) {
  return (
    <div className={cn("mn-loading-box", className)} role="status" aria-label={label}>
      <div className="mn-loading-box-copy">
        <span className="mn-loading-box-label">{label}</span>
        {description ? <span className="mn-loading-box-description">{description}</span> : null}
      </div>
      <LoadingLine label={label} trackClassName={trackClassName} />
    </div>
  );
}

export function LoadingOverlay({ label = "正在加载", description }: Pick<LoadingBoxProps, "label" | "description">) {
  return (
    <div className="mn-loading-overlay" role="status" aria-label={label}>
      <LoadingBox label={label} description={description} />
    </div>
  );
}
