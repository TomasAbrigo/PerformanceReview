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
  const facts = (g: GoalKpiGroup) =>
    (
      [
        ["completed", share(g.completed, g.completedPct)],
        ["inProgress", share(g.inProgress, g.inProgressPct)],
        ["overdue", share(g.overdue, g.overduePct)],
        [
          "avgProgress",
          g.avgProgress === null ? t("none") : `${decimal(g.avgProgress)} %`,
        ],
      ] as const
    ).map(([key, value]) => (
      <div key={key}>
        <dt>{t(`columns.${key}`)}</dt>
        <dd>{value}</dd>
      </div>
    ));
  const total = groups.find((g) => g.total);
  // Groups with goals as dense rows, most completed first; the ones without
  // goals folded into one line (they have no shares to compare).
  const withGoals = groups
    .filter((g) => !g.total && g.group.goals > 0)
    .sort((a, b) => (b.group.completedPct ?? 0) - (a.group.completedPct ?? 0));
  const without = groups.filter((g) => !g.total && g.group.goals === 0);
  return (
    <div className="flex flex-col gap-5" data-testid="kpis-table">
      {total ? (
        <article
          aria-label={total.name}
          className="comparison-card comparison-featured"
        >
          <header className="flex items-center gap-3">
            <IconTile>
              <Target className="size-5" />
            </IconTile>
            <div>
              <h3 className="text-xl">{total.name}</h3>
              <p className="mt-1 text-xs">
                {t("columns.people")}: {total.group.people} ·{" "}
                {t("columns.goals")}: {total.group.goals}
              </p>
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-5">
            {total.group.completedPct === null ? (
              <p>{t("none")}</p>
            ) : (
              <ProgressRing
                percent={total.group.completedPct}
                label={t("meter", {
                  group: total.name,
                  pct: pct(total.group.completedPct) ?? 0,
                })}
              />
            )}
            <dl className="dense-facts flex-1 [&_dt]:!text-brand-200">
              {facts(total.group)}
            </dl>
          </div>
        </article>
      ) : null}
      {withGoals.length > 0 ? (
        <>
          <GoalMixLegend />
          <CardCollection
            gridClassName="dense-list"
            initialCount={10}
            role="group"
            aria-label={t("title")}
          >
            {withGoals.map(({ group: g, name }) => (
              <article
                key={`${g.key}-${name}`}
                aria-label={name}
                className="dense-row dense-row-wide"
              >
                <div className="dense-name">
                  <span className="font-medium">{name}</span>
                  <small>
                    {t("columns.people")}: {g.people} · {t("columns.goals")}:{" "}
                    {g.goals}
                  </small>
                </div>
                <GoalMix
                  group={g}
                  label={t("meter", {
                    group: name,
                    pct: pct(g.completedPct) ?? 0,
                  })}
                />
                <dl className="dense-facts">{facts(g)}</dl>
              </article>
            ))}
          </CardCollection>
        </>
      ) : null}
      {without.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("withoutGoals")}</span>
          {without.map(({ group: g, name }) => (
            <article
              key={`${g.key}-${name}`}
              aria-label={name}
              className="rounded-full bg-brand-fog px-3 py-1 text-xs"
            >
              {name} · {t("columns.people")}: {g.people}
              <span className="sr-only"> · {t("none")}</span>
            </article>
          ))}
        </div>
      ) : null}
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

/** The goals of a group as one bar: completed, in progress, overdue, closed. */
function GoalMix({ group: g, label }: { group: GoalKpiGroup; label: string }) {
  const parts = [
    ["bg-status-done", g.completed],
    ["bg-brand-400", g.inProgress - g.overdue],
    ["bg-status-pending", g.overdue],
    ["bg-muted-foreground/30", g.closed],
  ] as const;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(g.completedPct ?? 0)}
      title={label}
      className="flex h-3 w-full overflow-hidden rounded-full bg-brand-fog"
    >
      {parts.map(([color, n]) =>
        n > 0 && g.goals > 0 ? (
          <span
            key={color}
            className={color}
            style={{ width: `${(n / g.goals) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

function GoalMixLegend() {
  const t = useTranslations("GoalsInsights.kpis");
  return (
    <p
      className="flex flex-wrap gap-4 text-xs text-muted-foreground"
      aria-hidden="true"
    >
      {(
        [
          ["bg-status-done", t("columns.completed")],
          ["bg-brand-400", t("legendOnTime")],
          ["bg-status-pending", t("columns.overdue")],
          ["bg-muted-foreground/30", t("legendClosed")],
        ] as const
      ).map(([color, text]) => (
        <span key={color} className="inline-flex items-center gap-1.5">
          <span className={`size-2.5 rounded-full ${color}`} />
          {text}
        </span>
      ))}
    </p>
  );
}
