import { formatDuration } from "@/lib/import-progress";

type ImportProgressPanelProps = {
  title: string;
  progress: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  estimatedSeconds: number;
  detail: string;
  stages: Array<{ label: string; activeAt: number }>;
};

export function ImportProgressPanel({
  title,
  progress,
  elapsedSeconds,
  remainingSeconds,
  estimatedSeconds,
  detail,
  stages
}: ImportProgressPanelProps) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="font-medium">{title}</span>
        <span className="font-mono text-muted-foreground">{progress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <span>已用 {formatDuration(elapsedSeconds)}</span>
        <span>预计剩余 {formatDuration(remainingSeconds)}</span>
        <span>预计总耗时 {formatDuration(estimatedSeconds)}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        {stages.map((stage) => (
          <span key={stage.label} className={progress >= stage.activeAt ? "text-primary" : ""}>
            {stage.label}
          </span>
        ))}
      </div>
    </div>
  );
}
