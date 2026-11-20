import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { type DrillBase, DrillLink } from "@/components/drill/drill-link";
import { ScaleBar } from "@/components/experience";
import type {
  Dm360,
  Dm360Card,
  Insight360,
} from "@/modules/analytics/dm-360/types";
import { cycleName } from "@/modules/review-core/cycle-name";
import type { DmMetric, Drill } from "@/modules/insights/drill-spec";
import {
  type KpiThresholds,
  likertTone,
  percentTone,
  type Tone,
} from "@/modules/insights/tone";
import { Sparkline } from "./sparkline";

/**
 * One figure of a card: its label, its value (a link to the people behind
 * it when the card can be drilled), what it is over, its scale and tone.
 */
function Figure({
  label,
  value,
  note,
  testId,
  scale,
  tone,
  drill,
}: {
  label: string;
  value: string;
  note?: string;
  testId: string;
  scale?: { value: number; min: number; max: number; label: string };
  tone?: Tone;
  drill?: { base: DrillBase; drill: Drill; label: string };
}) {
  const t = useTranslations("Experience");
  const shown: ReactNode = drill ? (
    <DrillLink {...drill} className="font-heading text-2xl tabular-nums">
      {value}
    </DrillLink>
  ) : (
    <span className="font-heading text-2xl tabular-nums">{value}</span>
  );
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/70 bg-card p-3"
      data-tone={tone}
    >
      <dt className="text-xs leading-tight text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center justify-between gap-1">
          <span
            className="flex flex-wrap items-baseline gap-x-1.5"
            data-testid={testId}
          >
            {shown}
            {note ? (
              <>
                {" "}
                <span className="text-xs text-muted-foreground">{note}</span>
              </>
            ) : null}
          </span>
          {tone ? (
            <span
              className="tone-pill shrink-0 px-1.5 text-[10px]"
              data-tone={tone}
            >
              {t(`tone.${tone}`)}
            </span>
          ) : null}
        </span>
        {scale ? (
          <ScaleBar
            {...scale}
            tone={tone}
            minLabel={String(scale.min)}
            maxLabel={scale.max === 100 ? "100 %" : String(scale.max)}
          />
        ) : null}
      </dd>
    </div>
  );
}

function CardView({
  card,
  team,
  riskThreshold,
  thresholds,
  base,
}: {
  card: Dm360Card;
  team: number;
  riskThreshold: number;
  thresholds?: KpiThresholds;
  /** Set when the card can be drilled (People or a manager, direct scope). */
  base?: DrillBase;
  cycleId: string;
}) {
  const t = useTranslations("Insights360");
  const locale = useLocale();
  const format = useFormatter();
  const one = (n: number) =>
    format.number(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const percent = (share: number) => Math.round(share * 100);
  const none = t("card.none");
  const name = card.others
    ? t("card.others")
    : (card.label ?? t("card.team", { n: team }));
  const s = card.signals;
  const canDrill = base && card.label !== null && !card.others;
  const drillOf = (metric: DmMetric, n: number | null) =>
    canDrill && n !== 0
      ? {
          base: base!,
          drill: { kind: "dm" as const, dm: card.key, metric },
          label: t(`drill.${metric}`, { dm: name }),
        }
      : undefined;
  // #133: the headline follows the tones of the card's KPIs; a mean short of
  // its target is a "watch" pill, never "no alerts".
  const alerts = card.insights.filter(
    (i) => i.code !== "stable" && i.code !== "belowTarget",
  );
  const pillText = (i: Insight360) =>
    i.code === "belowTarget"
      ? t("insight.belowTarget", {
          which: [
            i.params.retention ? t("card.retention") : null,
            i.params.engagement ? t("card.engagement") : null,
          ]
            .filter(Boolean)
            .join(", "),
        })
      : t(`insight.${i.code}`);
  const sentence = (i: Insight360) =>
    i.code === "retentionDrop" || i.code === "engagementDrop"
      ? t(`insight.${i.code}`, {
          ...i.params,
          cycle: cycleName({ name: i.params.cycle }, locale),
        })
      : "params" in i
        ? t(`insight.${i.code}`, i.params)
        : t(`insight.${i.code}`);
  const rate = (key: "self" | "manager", r: number | null) => (
    <Figure
      label={t(`card.${key}`)}
      testId={`dm-${key}`}
      value={r === null ? none : t("card.completion", { percent: percent(r) })}
      tone={
        r !== null && thresholds
          ? percentTone(percent(r), thresholds)
          : undefined
      }
      scale={
        r === null
          ? undefined
          : {
              value: percent(r),
              min: 0,
              max: 100,
              label: `${t(`card.${key}`)}: ${percent(r)} %`,
            }
      }
      drill={r !== null && r < 1 ? drillOf(key, null) : undefined}
    />
  );
  return (
    <article
      className="metric-card gap-4"
      aria-labelledby={`dm-${card.key}`}
      data-testid="dm-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`dm-${card.key}`} className="text-xl">
          {name}
        </h2>
        <div className="flex items-center gap-2">
          {alerts.length === 0 ? (
            <ul data-testid="dm-insights" className="flex">
              {card.insights.map((i) => (
                <li
                  key={i.code}
                  data-insight={i.code}
                  className="tone-pill"
                  data-tone={
                    i.code === "stable"
                      ? "good"
                      : i.code === "belowTarget"
                        ? "watch"
                        : undefined
                  }
                >
                  {pillText(i)}
                </li>
              ))}
            </ul>
          ) : null}
          <span
            className="text-sm text-muted-foreground"
            data-testid="dm-card-people"
          >
            {t("card.people", { n: card.people })}
          </span>
        </div>
      </header>
      {alerts.length > 0 ? (
        <ul
          className="insight-callout flex flex-col gap-1 text-sm"
          data-testid="dm-insights"
        >
          {alerts.map((i) => (
            <li key={i.code} data-insight={i.code}>
              {sentence(i)}
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Figure
          label={t("card.retention")}
          testId="dm-retention"
          value={card.retention ? one(card.retention.mean) : none}
          note={
            card.retention
              ? t("card.meanOf", { n: card.retention.n })
              : undefined
          }
          tone={
            card.retention
              ? likertTone(card.retention.mean, riskThreshold)
              : undefined
          }
          scale={
            card.retention
              ? {
                  value: card.retention.mean,
                  min: 1,
                  max: 5,
                  label: `${t("card.retention")}: ${one(card.retention.mean)}`,
                }
              : undefined
          }
          drill={card.retention ? drillOf("retention", null) : undefined}
        />
        <Figure
          label={t("card.engagement")}
          testId="dm-engagement"
          value={card.engagement ? one(card.engagement.mean) : none}
          note={
            card.engagement
              ? t("card.meanOf", { n: card.engagement.n })
              : undefined
          }
          tone={
            card.engagement
              ? likertTone(card.engagement.mean, riskThreshold)
              : undefined
          }
          scale={
            card.engagement
              ? {
                  value: card.engagement.mean,
                  min: 1,
                  max: 5,
                  label: `${t("card.engagement")}: ${one(card.engagement.mean)}`,
                }
              : undefined
          }
          drill={card.engagement ? drillOf("engagement", null) : undefined}
        />
        <Figure
          label={t("card.risk")}
          testId="dm-risk"
          value={
            card.risk
              ? t("card.riskValue", { percent: percent(card.risk.share) })
              : none
          }
          note={
            card.risk
              ? t("card.riskOf", { people: card.risk.people, of: card.risk.of })
              : undefined
          }
          tone={
            card.risk && thresholds
              ? percentTone(percent(card.risk.share), thresholds, "down")
              : undefined
          }
          scale={
            card.risk
              ? {
                  value: percent(card.risk.share),
                  min: 0,
                  max: 100,
                  label: `${t("card.risk")}: ${percent(card.risk.share)} %`,
                }
              : undefined
          }
          drill={card.risk ? drillOf("risk", card.risk.people) : undefined}
        />
        {rate("self", card.selfRate)}
        {rate("manager", card.managerRate)}
        <Figure
          label={t("card.signals")}
          testId="dm-signals"
          value={s ? `${percent(s.share)} %` : none}
          tone={
            s && thresholds
              ? percentTone(percent(s.share), thresholds, "down")
              : undefined
          }
          note={
            s
              ? t("card.signalsOf", { people: s.people, of: s.of })
              : t("card.noComments")
          }
          drill={s ? drillOf("comments", s.of) : undefined}
        />
      </dl>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">{t("card.trend")}</p>
        <Sparkline points={card.trend} />
      </div>
    </article>
  );
}

/** The DM cards of a cycle, with the people left out of them said, never hidden silently. */
export function Dm360View({
  data,
  base,
  thresholds,
}: {
  data: Dm360;
  /** Where the drills open; only used in the direct scope and with names. */
  base?: DrillBase;
  thresholds?: KpiThresholds;
}) {
  const t = useTranslations("Insights360");
  // The drills read the DM attribute itself: only the direct scope matches them.
  const drillBase =
    base && data.scope === "direct" && data.minGroupSize === null
      ? base
      : undefined;
  // Direction's teams have no name: they are numbered in the order shown.
  let team = 0;
  return (
    <div className="flex flex-col gap-4">
      {data.cards.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="dm-empty">
          {t("empty")}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="dm-cards">
          {data.cards.map((card) => (
            <CardView
              key={card.key}
              card={card}
              team={card.label === null && !card.others ? ++team : 0}
              riskThreshold={data.thresholds.riskThreshold}
              thresholds={thresholds}
              base={drillBase}
              cycleId={data.cycleId}
            />
          ))}
        </div>
      )}
      {data.suppressed > 0 && data.minGroupSize !== null ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="dm-suppressed"
        >
          {t("suppressed", { n: data.suppressed, min: data.minGroupSize })}
        </p>
      ) : null}
      {data.withoutDm ? (
        <p className="text-sm text-muted-foreground" data-testid="dm-without">
          {t("withoutDm", { n: data.withoutDm })}
        </p>
      ) : null}
    </div>
  );
}
