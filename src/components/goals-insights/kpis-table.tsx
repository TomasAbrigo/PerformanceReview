import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import { Target } from "lucide-react";
import { IconTile, ProgressRing } from "@/components/experience";
import { TableView } from "@/components/insights/parts";
import type {
  GoalKpiGroup,
  GoalKpis,
} from "@/modules/analytics/goals-insights/types";
import { Empty, useDecimal, usePct } from "./shared";

export function KpisTable({ kpis }: { kpis: GoalKpis }) {
  const t = useTranslations("GoalsInsights.kpis");
  const pct = usePct();
  const decimal = useDecimal();
  if (kpis.groups.length === 0 && kpis.suppressed === 0) return <Empty />;
  const teams = kpis.groups.filter((g) => g.key !== null && g.label === null);
  const label = (g: GoalKpiGroup) =>
    g.others
      ? t("others")
      : g.key !== null && g.label === null
        ? t("team", { n: teams.indexOf(g) + 1 })
        : (g.label ?? t("unassigned"));
  const share = (count: number, value: number | null) =>
    value === null ? t("none") : t("share", { count, pct: pct(value) ?? 0 });
  const groups = [
    ...(kpis.total
      ? [{ group: kpis.total, name: t("total"), total: true }]
      : []),
    ...kpis.groups.map((group) => ({
      group,
      name: label(group),
      total: false,
    })),
  ];
  const columns = [
    "group",
    "people",
    "goals",
    "completed",
    "inProgress",
    "overdue",
    "avgProgress",
  ] as const;
  return (
    <div className="flex flex-col gap-5" data-testid="kpis-table">
      <CardCollection
        gridClassName="comparison-grid"
        role="group"
        aria-label={t("title")}
      >
        {groups.map(({ group: g, name, total }, i) => (
          <article
            key={i}
            aria-label={name}
            className={`comparison-card ${total ? "comparison-featured" : ""}`}
          >
            <header className="flex items-center gap-3">
              <IconTile>
                <Target className="size-5" />
              </IconTile>
              <div>
                <h3 className="text-xl">{name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("columns.people")}: {g.people} · {t("columns.goals")}:{" "}
                  {g.goals}
                </p>
              </div>
            </header>
            <div className="flex flex-wrap items-center gap-5">
              {g.completedPct === null ? (
                <p>{t("none")}</p>
              ) : (
                <ProgressRing
                  percent={g.completedPct}
                  label={t("meter", {
                    group: name,
                    pct: pct(g.completedPct) ?? 0,
                  })}
                />
              )}
              <dl className="grid flex-1 grid-cols-2 gap-4 text-sm">
                {(
                  [
                    ["completed", share(g.completed, g.completedPct)],
                    ["inProgress", share(g.inProgress, g.inProgressPct)],
                    ["overdue", share(g.overdue, g.overduePct)],
                    [
                      "avgProgress",
                      g.avgProgress === null
                        ? t("none")
                        : `${decimal(g.avgProgress)} %`,
                    ],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs text-muted-foreground">
                      {t(`columns.${key}`)}
                    </dt>
                    <dd className="mt-2 font-heading text-xl tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </article>
        ))}
      </CardCollection>
      {kpis.suppressed > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("suppressed", { n: kpis.suppressed })}
          {kpis.total === null ? ` ${t("totalHidden")}` : ""}
        </p>
      ) : null}
      <TableView
        head={columns.map((key) => t(`columns.${key}`))}
        rows={groups.map(({ group: g, name }) => [
          name,
          g.people,
          g.goals,
          share(g.completed, g.completedPct),
          share(g.inProgress, g.inProgressPct),
          share(g.overdue, g.overduePct),
          g.avgProgress === null ? t("none") : `${decimal(g.avgProgress)} %`,
        ])}
      />
    </div>
  );
}
