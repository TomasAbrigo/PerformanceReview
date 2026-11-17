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
  GoalKpiGroup,
  GoalKpis,
} from "@/modules/analytics/goals-insights/types";
import { Empty, useDecimal, usePct } from "./shared";

const METER_W = 96;

/** Share of the goals completed, as a bar (single sequential hue, rounded data end). */
function CompletedMeter({ pct, label }: { pct: number; label: string }) {
  const w = (Math.max(0, Math.min(100, pct)) / 100) * METER_W;
  return (
    <svg width={METER_W} height={8} role="img" aria-label={label}>
      <title>{label}</title>
      <rect width={METER_W} height={8} rx={4} className="fill-muted" />
      {w > 0 ? (
        <rect
          width={Math.max(w, 8)}
          height={8}
          rx={4}
          className="fill-chart-seq"
        />
      ) : null}
    </svg>
  );
}

/**
 * The goal indicators of each group: goals, and how many (and what share)
 * are completed, in progress and overdue, and the mean progress. Direction's
 * "Otros" cell and the people left out are labelled, never hidden silently.
 */
export function KpisTable({ kpis }: { kpis: GoalKpis }) {
  const t = useTranslations("GoalsInsights.kpis");
  const pct = usePct();
  const decimal = useDecimal();
  if (kpis.groups.length === 0 && kpis.suppressed === 0) return <Empty />;
  const label = (g: GoalKpiGroup) =>
    g.others ? t("others") : (g.label ?? t("unassigned"));
  const share = (count: number, value: number | null) =>
    value === null ? t("none") : t("share", { count, pct: pct(value) ?? 0 });
  const row = (g: GoalKpiGroup, name: string, strong = false) => (
    <TableRow
      key={`${g.others}-${g.key ?? ""}-${name}`}
      className={strong ? "font-medium" : undefined}
    >
      <TableCell>{name}</TableCell>
      <TableCell className="tabular-nums">{g.people}</TableCell>
      <TableCell className="tabular-nums">{g.goals}</TableCell>
      <TableCell className="tabular-nums">
        <div className="flex items-center gap-2">
          {share(g.completed, g.completedPct)}
          {g.completedPct === null ? null : (
            <CompletedMeter
              pct={g.completedPct}
              label={t("meter", { group: name, pct: pct(g.completedPct) ?? 0 })}
            />
          )}
        </div>
      </TableCell>
      <TableCell className="tabular-nums">
        {share(g.inProgress, g.inProgressPct)}
      </TableCell>
      <TableCell className="tabular-nums">
        {share(g.overdue, g.overduePct)}
      </TableCell>
      <TableCell className="tabular-nums">
        {g.avgProgress === null ? t("none") : `${decimal(g.avgProgress)} %`}
      </TableCell>
    </TableRow>
  );
  return (
    <div className="flex flex-col gap-2">
      <Table aria-label={t("title")} data-testid="kpis-table">
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.group")}</TableHead>
            <TableHead>{t("columns.people")}</TableHead>
            <TableHead>{t("columns.goals")}</TableHead>
            <TableHead>{t("columns.completed")}</TableHead>
            <TableHead>{t("columns.inProgress")}</TableHead>
            <TableHead>{t("columns.overdue")}</TableHead>
            <TableHead>{t("columns.avgProgress")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {kpis.groups.map((g) => row(g, label(g)))}
          {kpis.total ? row(kpis.total, t("total"), true) : null}
        </TableBody>
      </Table>
      {kpis.suppressed > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("suppressed", { n: kpis.suppressed })}
          {kpis.total === null ? ` ${t("totalHidden")}` : ""}
        </p>
      ) : null}
    </div>
  );
}
