import { useTranslations } from "next-intl";
import { Meter } from "@/components/dashboards/parts";
import type {
  Completion,
  CompletionGroup,
  Ratio,
} from "@/modules/insights/completion";

export const pct = (r: Ratio) =>
  r.total ? Math.round((r.submitted / r.total) * 100) : 0;

/** Completion per group (self and manager), meters in inline SVG. */
export function CompletionTable({ data }: { data: Completion }) {
  const t = useTranslations("Insights.completion");
  const ti = useTranslations("Insights");
  const rows: (Omit<CompletionGroup, "key" | "label"> & {
    id: string;
    label: string;
  })[] = [
    ...data.groups.map((g) => ({
      ...g,
      id: g.key ?? "none",
      label: g.label ?? t("noDepartment"),
    })),
    ...(data.others
      ? [{ ...data.others, id: "others", label: ti("others") }]
      : []),
    ...(data.total ? [{ ...data.total, id: "total", label: t("all") }] : []),
  ];
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{ti("empty")}</p>;
  }
  const cell = (label: string, side: string, r: Ratio) => (
    <div className="flex items-center gap-2">
      <Meter
        width={100}
        value={r.total ? r.submitted / r.total : 0}
        label={t("meter", {
          label: `${label} · ${side}`,
          submitted: r.submitted,
          total: r.total,
        })}
      />
      <span className="tabular-nums">{ti("percent", { value: pct(r) })}</span>
    </div>
  );
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
              <td className="pr-4">{r.label}</td>
              <td className="pr-4 tabular-nums">{r.n}</td>
              <td className="pr-4">{cell(r.label, t("self"), r.self)}</td>
              <td className="pr-4">{cell(r.label, t("manager"), r.manager)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.minGroupSize !== null ? (
        <p className="text-xs text-muted-foreground">
          {ti("suppressed", { n: data.suppressed })}
        </p>
      ) : null}
    </div>
  );
}
