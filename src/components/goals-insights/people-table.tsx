import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import { UserRound } from "lucide-react";
import { IconTile } from "@/components/experience";
import { ProgressBar } from "@/components/progress-bar";
import type { GoalIndicatorRow } from "@/modules/analytics/goals-insights/types";
import { Empty, useDecimal, usePct } from "./shared";

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
      gridClassName="record-grid"
    >
      {rows.map((r) => (
        <article
          key={r.participantId}
          className="record-card"
          aria-label={r.name}
        >
          <header className="flex items-center gap-3">
            <IconTile>
              <UserRound className="size-5" />
            </IconTile>
            <div>
              <h3 className="text-xl">{r.name}</h3>
              <p className="text-xs text-muted-foreground">
                {t("columns.manager")}: {r.managerName ?? dash}
              </p>
            </div>
          </header>
          <div className="rounded-xl bg-brand-fog p-4">
            <p className="mb-3 flex justify-between gap-3 text-sm">
              <span>{t("columns.completed")}</span>
              <span>
                {t("columns.goals")}: {r.goals}
              </span>
            </p>
            {r.completedPct === null ? (
              <p>{dash}</p>
            ) : (
              <ProgressBar
                percent={r.completedPct}
                label={t("columns.completed")}
              />
            )}
          </div>
          <dl className="record-facts">
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
                <dd>
                  <span className="font-heading text-xl tabular-nums">
                    {value}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </CardCollection>
  );
}
