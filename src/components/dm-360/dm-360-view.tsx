import { useFormatter, useTranslations } from "next-intl";
import { MiniBar } from "@/components/qualitative/sentiment-bars";
import type { Dm360, Dm360Card } from "@/modules/analytics/dm-360/types";
import { sentiments } from "@/modules/qualitative-analysis/constants";
import { Sparkline } from "./sparkline";

/** One figure of a card: a label, its value and, beside it, what it is over. */
function Figure({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note?: string;
  testId: string;
}) {
  return (
    <div className="dm-figure">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className="flex flex-wrap items-baseline gap-x-1.5"
        data-testid={testId}
      >
        <span className="font-heading text-2xl tabular-nums">{value}</span>
        {note ? (
          <>
            {" "}
            <span className="text-xs text-muted-foreground">{note}</span>
          </>
        ) : null}
      </dd>
    </div>
  );
}

function CardView({ card, team }: { card: Dm360Card; team: number }) {
  const t = useTranslations("Insights360");
  const ts = useTranslations("Qualitative.sentiment");
  const format = useFormatter();
  const one = (n: number) =>
    format.number(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const percent = (share: number) => Math.round(share * 100);
  const none = t("card.none");
  const name = card.others
    ? t("card.others")
    : (card.label ?? t("card.team", { n: team }));
  const s = card.sentiment;
  return (
    <article
      className="metric-card gap-5"
      aria-labelledby={`dm-${card.key}`}
      data-testid="dm-card"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`dm-${card.key}`} className="text-xl">
          {name}
        </h2>
        <span
          className="text-sm text-muted-foreground"
          data-testid="dm-card-people"
        >
          {t("card.people", { n: card.people })}
        </span>
      </header>
      <dl className="dm-figures">
        <Figure
          label={t("card.retention")}
          testId="dm-retention"
          value={card.retention ? one(card.retention.mean) : none}
          note={
            card.retention
              ? t("card.meanOf", { n: card.retention.n })
              : undefined
          }
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
        />
        <Figure
          label={t("card.self")}
          testId="dm-self"
          value={
            card.selfRate === null
              ? none
              : t("card.completion", { percent: percent(card.selfRate) })
          }
        />
        <Figure
          label={t("card.manager")}
          testId="dm-manager"
          value={
            card.managerRate === null
              ? none
              : t("card.completion", { percent: percent(card.managerRate) })
          }
        />
      </dl>
      <div className="dm-block">
        <p className="flex flex-wrap justify-between gap-x-3 text-sm">
          <span>{t("card.sentiment")}</span>
          <span className="text-muted-foreground" data-testid="dm-comments">
            {s
              ? t("card.comments", { n: s.comments, people: s.people })
              : t("card.noComments")}
          </span>
        </p>
        {s ? (
          <div className="flex flex-col gap-2" data-testid="dm-sentiment">
            <MiniBar
              counts={{ ...s.counts, total: s.comments }}
              label={sentiments
                .map((k) => `${ts(k)} ${percent(s.share[k])} %`)
                .join(", ")}
            />
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {sentiments
                .filter((k) => s.counts[k] > 0)
                .map((k) => (
                  <span key={k}>
                    {ts(k)} {percent(s.share[k])} %
                  </span>
                ))}
            </p>
          </div>
        ) : null}
      </div>
      <div className="dm-block">
        <p className="text-sm">{t("card.trend")}</p>
        <Sparkline points={card.trend} />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t("card.reading")}</h3>
        <ul
          className="flex list-disc flex-col gap-1 pl-5 text-sm"
          data-testid="dm-insights"
        >
          {card.insights.map((i) => (
            <li key={i.code} data-insight={i.code}>
              {"params" in i
                ? t(`insight.${i.code}`, i.params)
                : t(`insight.${i.code}`)}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

/** The DM cards of a cycle, with the people left out of them said, never hidden silently. */
export function Dm360View({ data }: { data: Dm360 }) {
  const t = useTranslations("Insights360");
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
