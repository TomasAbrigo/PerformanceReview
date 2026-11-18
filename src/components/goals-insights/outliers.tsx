import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
    <TableRow key={p.participantId}>
      <TableCell>{p.name}</TableCell>
      <TableCell>{p.managerName ?? "–"}</TableCell>
      <TableCell className="tabular-nums">
        {t("completed", {
          completed: p.completed,
          goals: p.goals,
          pct: pct(p.completedPct) ?? 0,
        })}
      </TableCell>
      <TableCell className="tabular-nums">{p.retention ?? "–"}</TableCell>
      <TableCell className="tabular-nums">{p.engagement ?? "–"}</TableCell>
    </TableRow>
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
        <Table aria-label={title}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.person")}</TableHead>
              <TableHead>{t("columns.manager")}</TableHead>
              <TableHead>{t("columns.completed")}</TableHead>
              <TableHead>{t("columns.retention")}</TableHead>
              <TableHead>{t("columns.engagement")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{group.people.map(person)}</TableBody>
        </Table>
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
