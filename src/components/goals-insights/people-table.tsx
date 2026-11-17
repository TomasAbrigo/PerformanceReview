import { useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import type { GoalIndicatorRow } from "@/modules/analytics/goals-insights/types";
import { Empty, useDecimal, usePct } from "./shared";

/** Every person of the view: goals, indicators and positive comments side by side. */
export function PeopleTable({
  rows,
  cycleId,
}: {
  rows: GoalIndicatorRow[];
  cycleId: string;
}) {
  const t = useTranslations("GoalsInsights");
  const tc = useTranslations("GoalsInsights.people");
  const pct = usePct();
  const decimal = useDecimal();
  if (rows.length === 0) return <Empty />;
  const dash = tc("noValue");
  return (
    <Table aria-label={tc("title")} data-testid="people-table">
      <TableHeader>
        <TableRow>
          <TableHead>{tc("columns.name")}</TableHead>
          <TableHead>{tc("columns.manager")}</TableHead>
          <TableHead>{tc("columns.goals")}</TableHead>
          <TableHead>{tc("columns.completed")}</TableHead>
          <TableHead>{tc("columns.avgProgress")}</TableHead>
          <TableHead>{tc("columns.retention")}</TableHead>
          <TableHead>{tc("columns.engagement")}</TableHead>
          <TableHead>{tc("columns.positive")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.participantId}>
            <TableCell>
              <Link
                href={`/cycles/${cycleId}/participants/${r.participantId}`}
                className="underline"
                aria-label={t("personLink", { name: r.name })}
              >
                {r.name}
              </Link>
            </TableCell>
            <TableCell>{r.managerName ?? dash}</TableCell>
            <TableCell className="tabular-nums">{r.goals}</TableCell>
            <TableCell className="tabular-nums">
              {r.completedPct === null ? dash : `${pct(r.completedPct)} %`}
            </TableCell>
            <TableCell className="tabular-nums">
              {r.avgProgress === null ? dash : `${decimal(r.avgProgress)} %`}
            </TableCell>
            <TableCell className="tabular-nums">
              {r.retention ?? dash}
            </TableCell>
            <TableCell className="tabular-nums">
              {r.engagement ?? dash}
            </TableCell>
            <TableCell className="tabular-nums">
              {r.positiveShare === null
                ? dash
                : `${pct(r.positiveShare * 100)} %`}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
