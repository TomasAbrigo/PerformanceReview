import { useTranslations } from "next-intl";
import { ProgressBar } from "@/components/progress-bar";
import type {
  GoalOutlier,
  GoalOutliers,
  OutlierGroup,
} from "@/modules/analytics/goals-insights/types";
import { usePct } from "./shared";

/** One group of outliers: how many, and (People, managers) who. */
function Group({
  testId,
  title,
  description,
  group,
  minGroupSize,
}: {
  testId: string;
  title: string;
  description: string;
  group: OutlierGroup;
  minGroupSize: number | null;
}) {
  const t = useTranslations("GoalsInsights.outliers");
  const pct = usePct();
  const person = (p: GoalOutlier) => (
    <article key={p.participantId} className="record-card" aria-label={p.name}>
      <h4 className="text-lg">{p.name}</h4>
      <p className="text-xs text-muted-foreground">
        {t("columns.manager")}: {p.managerName ?? "–"}
      </p>
      <ProgressBar
        percent={p.completedPct}
        label={t("completed", {
          completed: p.completed,
          goals: p.goals,
          pct: pct(p.completedPct) ?? 0,
        })}
      />
      <p className="text-xs">
        {t("completed", {
          completed: p.completed,
          goals: p.goals,
          pct: pct(p.completedPct) ?? 0,
        })}
      </p>
      <dl className="record-facts">
        <div>
          <dt>{t("columns.retention")}</dt>
          <dd>{p.retention ?? "–"}</dd>
        </div>
        <div>
          <dt>{t("columns.engagement")}</dt>
          <dd>{p.engagement ?? "–"}</dd>
        </div>
      </dl>
    </article>
  );
  return (
    <section
      aria-labelledby={`${testId}-title`}
      data-testid={testId}
      className="flex flex-col gap-2"
    >
      <h3 id={`${testId}-title`} className="font-medium">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground">{description}</p>
      <p className="text-sm" data-testid={`${testId}-count`}>
        {group.count === null
          ? t("hidden", { min: minGroupSize ?? 0 })
          : t("count", { n: group.count })}
      </p>
      {group.people.length > 0 ? (
        <div className="grid gap-4">{group.people.map(person)}</div>
      ) : group.count === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : null}
    </section>
  );
}

/**
 * Goals and indicators that disagree: done goals with low retention or
 * engagement, and goals behind with both indicators high. The thresholds are
 * the ones the query used (the risk threshold is a setting).
 */
export function OutliersView({ data }: { data: GoalOutliers }) {
  const t = useTranslations("GoalsInsights.outliers");
  const { thresholds: th } = data;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Group
        testId="outliers-done-low"
        title={t("doneButLow.title")}
        description={t("doneButLow.description", {
          goals: th.goalsHigh,
          risk: th.riskThreshold,
        })}
        group={data.doneButLow}
        minGroupSize={data.minGroupSize}
      />
      <Group
        testId="outliers-behind-high"
        title={t("behindButHigh.title")}
        description={t("behindButHigh.description", {
          goals: th.goalsLow,
          high: th.indicatorHigh,
        })}
        group={data.behindButHigh}
        minGroupSize={data.minGroupSize}
      />
    </div>
  );
}
