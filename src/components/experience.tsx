import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDot,
  Minus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type DrillBase, DrillLink } from "@/components/drill/drill-link";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { Drill } from "@/modules/insights/drill-spec";
import type { Tone } from "@/modules/insights/tone";

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

/**
 * A value on its scale (1–5, 0–100 %): a track with the value filled in the
 * tone's colour and the ends written, so no number floats without an anchor.
 * `target` marks where "on target" starts (a tick on the track and its text
 * between the ends), so the tone is read against something (#119).
 * `role="meter"` with min, max and value for assistive tech.
 */
export function ScaleBar({
  value,
  min,
  max,
  label,
  tone,
  minLabel = String(min),
  maxLabel = String(max),
  target,
}: {
  value: number;
  min: number;
  max: number;
  /** Accessible name, value included ("Retención: 3,4 de 5"). */
  label: string;
  tone?: Tone;
  minLabel?: string;
  maxLabel?: string;
  /** Where good starts, on the same scale, and how it is written ("Meta 80 %"). */
  target?: { value: number; label: string };
}) {
  const shareOf = (v: number) =>
    max > min && Number.isFinite(v)
      ? Math.min(1, Math.max(0, (v - min) / (max - min)))
      : 0;
  const share = shareOf(value);
  const mark =
    target && target.value >= min && target.value <= max ? target : undefined;
  const name = mark ? `${label} · ${mark.label}` : label;
  return (
    <div className="scale-bar" data-tone={tone}>
      <div className="scale-rail">
        <div
          role="meter"
          aria-label={name}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          title={name}
          className="scale-track"
        >
          <span className="scale-fill" style={{ width: `${share * 100}%` }} />
        </div>
        {mark ? (
          <span
            aria-hidden="true"
            className="scale-target"
            style={{ left: `${shareOf(mark.value) * 100}%` }}
          />
        ) : null}
      </div>
      <div className="scale-ends" aria-hidden="true">
        <span>{minLabel}</span>
        {mark ? (
          <span
            className="scale-target-label"
            // Near an end the text leans away from it, clear of that end's label.
            data-align={
              shareOf(mark.value) > 0.7
                ? "end"
                : shareOf(mark.value) < 0.3
                  ? "start"
                  : "center"
            }
            style={{ left: `${shareOf(mark.value) * 100}%` }}
          >
            {mark.label}
          </span>
        ) : null}
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

/** A change against the previous cycle, green when it goes the good way. */
export function DeltaPill({
  value,
  text,
  better = "up",
}: {
  /** Signed change; 0 is flat. */
  value: number;
  /** The change as written ("+0,3 vs. 2025-H1"). */
  text: string;
  better?: "up" | "down";
}) {
  const good = value === 0 ? null : value > 0 === (better === "up");
  // Flat is neither up nor down: a dash, not an arrow.
  const Arrow = value === 0 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "delta-pill items-center gap-1",
        good === true && "delta-good",
        good === false && "delta-bad",
      )}
      data-testid="delta"
    >
      <Arrow className="size-3.5" aria-hidden="true" />
      {text}
    </span>
  );
}

/**
 * A KPI. Besides label and value it can carry its context: `scale` draws the
 * value on its range (ScaleBar), `status` the tone from the settings'
 * thresholds (`likertTone` / `percentTone` of modules/insights/tone) as a
 * coloured edge plus a written word, `delta` the change vs. the previous
 * cycle, and `drill` makes the value open the records behind it.
 */
export function MetricCard({
  label,
  value,
  note,
  icon,
  featured = false,
  tone = featured ? "featured" : "default",
  status,
  scale,
  delta,
  drill,
  href,
  testId,
  children,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  featured?: boolean;
  /** `featured`: the dark card; `soft`: fog; `warm`: the "to review" amber. */
  tone?: "default" | "featured" | "soft" | "warm";
  /** good / watch / risk, from the thresholds of /settings/insights. */
  status?: Tone;
  scale?: {
    value: number;
    min: number;
    max: number;
    label: string;
    minLabel?: string;
    maxLabel?: string;
    /** Where good starts on this scale, as written ("80 %", "4"). */
    target?: { value: number; text: string };
  };
  delta?: { value: number; text: string; better?: "up" | "down" };
  /** The value becomes a DrillLink to these records. */
  drill?: { base: DrillBase; drill: Drill; label: string };
  /** Without `drill`: the value links here (a list filtered by this KPI). */
  href?: string;
  testId?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("Experience");
  return (
    <section
      className={cn(
        "metric-card",
        tone === "featured" && "metric-card-featured",
        tone === "soft" && "metric-card-soft",
        tone === "warm" && "metric-card-warm",
        status && "metric-card-status",
      )}
      data-tone={status}
      data-testid={testId}
      aria-label={label}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm">{label}</p>
        <IconTile>{icon ?? <CircleDot className="size-5" />}</IconTile>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {drill ? (
          <DrillLink
            base={drill.base}
            drill={drill.drill}
            label={drill.label}
            className="stat-value"
          >
            {value}
          </DrillLink>
        ) : href ? (
          <Link href={href} className="stat-value drill-target">
            {value}
          </Link>
        ) : (
          <p className="stat-value">{value}</p>
        )}
        {status ? (
          <span className="tone-pill" data-tone={status}>
            {t(`tone.${status}`)}
          </span>
        ) : null}
        {delta ? <DeltaPill {...delta} /> : null}
      </div>
      {scale ? (
        <ScaleBar
          {...scale}
          tone={status}
          target={
            scale.target
              ? {
                  value: scale.target.value,
                  label: t("target", { value: scale.target.text }),
                }
              : undefined
          }
        />
      ) : null}
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
