import type { ReactNode } from "react";

/** A progress bar with its figure beside it (the figure is the text, the bar its picture). */
export function ProgressBar({
  percent,
  label,
  figure,
}: {
  percent: number;
  label: string;
  /** What to write beside the bar; default the rounded percentage. */
  figure?: ReactNode;
}) {
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-brand-fog"
      >
        <div
          className="h-full rounded-full bg-brand-600"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {figure ?? `${value}%`}
      </span>
    </div>
  );
}
