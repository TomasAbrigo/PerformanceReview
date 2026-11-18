import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import { ProgressBar } from "@/components/progress-bar";
import type { GoalIndicatorRow } from "@/modules/analytics/goals-insights/types";
import { Empty, useDecimal, usePct } from "./shared";

/**
 * The people of the cycle, one dense row each: who and their manager, how
 * many goals and how many are done (a bar), then the average progress, the
 * two indicators and the share of positive comments side by side.
 */
export function PeopleTable({ rows }: { rows: GoalIndicatorRow[] }) {
  const t = useTranslations("GoalsInsights.people");
  const pct = usePct();
  const decimal = useDecimal();
  if (!rows.length) return <Empty />;
  const dash = t("noValue");
  return (
    <CardCollection
      role="group"
      aria-label={t("title")}
      data-testid="people-table"
      gridClassName="dense-list"
      initialCount={12}
    >
      {rows.map((r) => (
        <article
          key={r.participantId}
          className="dense-row dense-row-wide"
          aria-label={r.name}
        >
          <div className="dense-name">
            <span className="font-medium">{r.name}</span>
            <small>
              {t("columns.manager")}: {r.managerName ?? dash}
            </small>
          </div>
          <dl className="dense-bar">
            <dt>
              {t("columns.completed")} · {t("columns.goals")}: {r.goals}
            </dt>
            <dd>
              {r.completedPct === null ? (
                dash
              ) : (
                <ProgressBar
                  percent={r.completedPct}
                  label={t("columns.completed")}
                />
              )}
            </dd>
          </dl>
          <dl className="dense-facts">
            {(
              [
                [
                  "avgProgress",
                  r.avgProgress === null ? dash : `${decimal(r.avgProgress)} %`,
                ],
                ["retention", r.retention ?? dash],
                ["engagement", r.engagement ?? dash],
                [
                  "positive",
                  r.positiveShare === null
                    ? dash
                    : `${pct(r.positiveShare * 100)} %`,
                ],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`columns.${key}`)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </CardCollection>
  );
}
