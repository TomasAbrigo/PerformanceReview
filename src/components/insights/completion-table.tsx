import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import { ProgressRing } from "@/components/experience";
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
      <div className="completion-side">
        <p className="text-sm">{t(side)}</p>
        <div className="flex items-center gap-4">
          <ProgressRing
            percent={pct(v)}
            label={t("meter", {
              label: `${r.name} · ${t(side)}`,
              submitted: v.submitted,
              total: v.total,
            })}
          />
          <span className="text-sm tabular-nums">
            {v.submitted}/{v.total}
          </span>
        </div>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <CardCollection
        role="group"
        aria-label={t("table")}
        gridClassName="comparison-grid"
      >
        {rows.map((r) => (
          <article
            key={r.id}
            className={`comparison-card ${r.id === "total" ? "comparison-featured" : ""}`}
          >
            <header>
              <h3 className="text-xl">{r.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("n")}: {r.participants}
              </p>
            </header>
            <div className="comparison-metrics">
              {cell(r, "self")}
              {cell(r, "manager")}
            </div>
          </article>
        ))}
      </CardCollection>
      {suppressed}
    </div>
  );
}
