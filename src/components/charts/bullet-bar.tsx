import { useTranslations } from "next-intl";
import { useChartFormat } from "./format";

/**
 * A completion as a bullet bar: the value (sequential hue) on a light track,
 * an optional target tick, and the percent as text next to it.
 */
export function BulletBar({
  value,
  target,
  label,
  width = 160,
  showValue = true,
  fullLabel = false,
}: {
  /** `label` already says the value: use it as the accessible name as is. */
  fullLabel?: boolean;
  /** 0-1. */
  value: number;
  /** 0-1. */
  target?: number | null;
  label: string;
  width?: number;
  showValue?: boolean;
}) {
  const t = useTranslations("Charts");
  const f = useChartFormat();
  const v = Math.max(0, Math.min(1, value));
  const tip = fullLabel
    ? label
    : target != null
      ? t("bullet.tipTarget", {
          label,
          value: f.share(v),
          target: f.share(target),
        })
      : t("bullet.tip", { label, value: f.share(v) });
  return (
    <span className="inline-flex items-center gap-2" data-testid="bullet-bar">
      <span
        role="img"
        aria-label={tip}
        title={tip}
        className="relative inline-block h-2.5 rounded-sm bg-brand-200/60"
        style={{ width }}
      >
        {v > 0 ? (
          <span
            className="absolute inset-y-0 left-0 rounded-sm bg-chart-seq"
            style={{ width: `${Math.max(v * 100, 3)}%` }}
          />
        ) : null}
        {target != null ? (
          <span
            aria-hidden="true"
            className="absolute -inset-y-1 w-0.5 bg-foreground"
            style={{ left: `${target * 100}%` }}
          />
        ) : null}
      </span>
      {showValue ? (
        <span className="text-xs font-medium tabular-nums">{f.share(v)}</span>
      ) : null}
    </span>
  );
}
