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
