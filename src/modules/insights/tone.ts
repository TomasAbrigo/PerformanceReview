// Pure and server-free: the status tone of a KPI (good / watch / risk), from
// the thresholds People keep in /settings/insights.
import { bandOf } from "@/modules/analytics/indicators/types";
import type { Settings } from "@/modules/settings/definitions";

export const tones = ["good", "watch", "risk"] as const;
export type Tone = (typeof tones)[number];

/**
 * A mean on the Likert 1-5 scale, with the bands of the risk matrix: at or
 * under `alerts.riskThreshold` is risk, from its mirror value up is good,
 * between is watch.
 */
export function likertTone(mean: number, riskThreshold: number): Tone {
  const band = bandOf(mean, riskThreshold);
  return band === "low" ? "risk" : band === "high" ? "good" : "watch";
}

/**
 * The value on 1-5 where the good band starts (`bandOf`'s high band): the
 * target a ScaleBar marks. 4 with the default threshold of 2.
 */
export function likertTarget(riskThreshold: number): number {
  return Math.max(riskThreshold + 1, 5 + 1 - riskThreshold);
}

/** The percent thresholds of the KPIs (`targets.goodPct`, `targets.watchPct`). */
export type KpiThresholds = { goodPct: number; watchPct: number };

export const kpiThresholds = (
  s: Pick<Settings, "targets.goodPct" | "targets.watchPct">,
): KpiThresholds => ({
  goodPct: s["targets.goodPct"],
  watchPct: s["targets.watchPct"],
});

/**
 * A 0-100 percent: from `goodPct` up good, from `watchPct` up watch, risk
 * below. `better: "down"` mirrors it for a share where less is better
 * (overdue goals): up to 100 - goodPct good, up to 100 - watchPct watch.
 */
export function percentTone(
  pct: number,
  t: KpiThresholds,
  better: "up" | "down" = "up",
): Tone {
  const v = better === "up" ? pct : 100 - pct;
  return v >= t.goodPct ? "good" : v >= t.watchPct ? "watch" : "risk";
}

/**
 * The percent where good starts: `goodPct`, or its mirror for a share where
 * less is better. The target a ScaleBar marks.
 */
export function percentTarget(
  t: KpiThresholds,
  better: "up" | "down" = "up",
): number {
  return better === "up" ? t.goodPct : 100 - t.goodPct;
}

/**
 * quant (#117): a count of people at risk, where more is worse. Nobody at
 * risk is good; anybody is at least watch; a share of `100 - goodPct` percent
 * or more of the people counted is risk (20 % with the defaults).
 */
export function atRiskTone(
  count: number,
  total: number,
  t: KpiThresholds,
): Tone {
  if (count <= 0) return "good";
  const pct = total > 0 ? (count / total) * 100 : 100;
  return pct >= 100 - t.goodPct ? "risk" : "watch";
}
