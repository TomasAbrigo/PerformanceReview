import { useTranslations } from "next-intl";
import { Meter } from "@/components/insights/parts";
import type {
  CompletionGroup,
  CompletionGroupBy,
  CompletionSummary,
} from "@/modules/analytics/completion";

export type Side = "self" | "manager";

/** submitted / applicable of one side of a group. */
export const sideOf = (g: CompletionGroup, side: Side) =>
  side === "self"
    ? { submitted: g.selfSubmitted, total: g.selfApplicable }
    : { submitted: g.managerSubmitted, total: g.managerApplicable };

export const pct = (r: { submitted: number; total: number }) =>
  r.total ? Math.round((r.submitted / r.total) * 100) : 0;

/** Completion per group (self and manager), meters in inline SVG. */
export function CompletionTable({
  data,
  groupBy = "department",
}: {
  data: CompletionSummary;
  /** What the groups are: words the group without a key. */
  groupBy?: CompletionGroupBy;
}) {
  const t = useTranslations("Insights.completion");
  const ti = useTranslations("Insights");
  // A team with a key but no name is one of direction's (a manager is a
  // person): numbered in the order they come.
  const teams = data.groups.filter((g) => g.key !== null && g.label === null);
  const rows: (CompletionGroup & { id: string; name: string })[] = [
    ...data.groups.map((g) => ({
      ...g,
      id: g.key ?? "none",
      name:
        g.key !== null && g.label === null
          ? t("team", { n: teams.indexOf(g) + 1 })
          : (g.label ??
            t(groupBy === "manager" ? "noManager" : "noDepartment")),
    })),
    ...(data.others
      ? [{ ...data.others, id: "others", name: ti("others") }]
      : []),
    ...(data.total ? [{ ...data.total, id: "total", name: t("all") }] : []),
  ];
  const suppressed =
    data.minGroupSize !== null ? (
      <p className="text-xs text-muted-foreground">
        {ti("suppressed", { n: data.suppressed })}
      </p>
    ) : null;
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {data.suppressed > 0 ? null : (
          <p className="text-sm text-muted-foreground">{ti("empty")}</p>
        )}
        {suppressed}
      </div>
    );
  }
  const cell = (r: (typeof rows)[number], side: Side) => {
    const v = sideOf(r, side);
    return (
      <div className="flex items-center gap-2">
        <Meter
          width={100}
          value={v.total ? v.submitted / v.total : 0}
          label={t("meter", {
            label: `${r.name} · ${t(side)}`,
            submitted: v.submitted,
            total: v.total,
          })}
        />
        <span className="tabular-nums">{ti("percent", { value: pct(v) })}</span>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <table aria-label={t("table")} className="text-sm">
        <thead>
          <tr className="text-left">
            <th className="pr-4">{t("group")}</th>
            <th className="pr-4">{t("n")}</th>
            <th className="pr-4">{t("self")}</th>
            <th className="pr-4">{t("manager")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="pr-4">{r.name}</td>
              <td className="pr-4 tabular-nums">{r.participants}</td>
              <td className="pr-4">{cell(r, "self")}</td>
              <td className="pr-4">{cell(r, "manager")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {suppressed}
    </div>
  );
}
