import type { ReactNode } from "react";
import { CircleDot, Search, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Shared visual vocabulary from the approved Santex canvas. */
export function IconTile({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn("icon-tile", className)}>
      {children}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  note,
  icon,
  featured = false,
  tone = featured ? "featured" : "default",
  children,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  featured?: boolean;
  /** `featured`: the dark card; `soft`: fog; `warm`: the "to review" amber. */
  tone?: "default" | "featured" | "soft" | "warm";
  children?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "metric-card",
        tone === "featured" && "metric-card-featured",
        tone === "soft" && "metric-card-soft",
        tone === "warm" && "metric-card-warm",
      )}
      aria-label={label}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm">{label}</p>
        <IconTile>{icon ?? <CircleDot className="size-5" />}</IconTile>
      </div>
      <p className="stat-value">{value}</p>
      {note ? <p className="metric-note text-xs">{note}</p> : null}
      {children}
    </section>
  );
}

export function ProgressRing({
  percent,
  label,
  children,
}: {
  percent: number;
  label: string;
  children?: ReactNode;
}) {
  const value = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="progress-ring"
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" className="ring-track" />
        <circle
          cx="60"
          cy="60"
          r="52"
          className="ring-value"
          pathLength="100"
          strokeDasharray={`${value} 100`}
          opacity={value === 0 ? 0 : 1}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <span className="font-heading text-3xl">
        {children ?? `${Math.round(value)}%`}
      </span>
    </div>
  );
}

export function EmptyState({
  children,
  icon,
}: {
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <IconTile>{icon ?? <Search className="size-6" />}</IconTile>
      <div className="max-w-lg text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

export function AdvancedFilters({
  children,
  active = false,
}: {
  children: ReactNode;
  active?: boolean;
}) {
  const t = useTranslations("Experience");
  return (
    <details className="advanced-filters" open={active || undefined}>
      <summary className="button-outline cursor-pointer">
        <SlidersHorizontal className="mr-2 size-4" aria-hidden="true" />
        {t("moreFilters")}
        {active ? (
          <span className="ml-2 size-2 rounded-full bg-primary" />
        ) : null}
      </summary>
      <div className="flex flex-wrap items-end gap-4 pt-4">{children}</div>
    </details>
  );
}

export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Loading">
      <div className="h-9 w-64 rounded-lg bg-brand-200/50" />
      <div className="grid gap-5 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 rounded-xl bg-brand-fog" />
        ))}
      </div>
      <div className="h-72 rounded-xl bg-brand-fog" />
    </div>
  );
}

export function UploadSteps({ step }: { step: number }) {
  const t = useTranslations("Experience");
  return (
    <ol className="upload-steps">
      {(["upload", "review", "result"] as const).map((key, i) => (
        <li
          key={key}
          className="upload-step"
          aria-current={step === i ? "step" : undefined}
        >
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              i <= step
                ? "bg-primary text-white"
                : "bg-brand-fog text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <span>{t(key)}</span>
        </li>
      ))}
    </ol>
  );
}
