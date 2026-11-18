import { useFormatter, useTranslations } from "next-intl";
import type {
  MeanOf,
  PeriodDetail,
} from "@/modules/analytics/period-detail/types";

/**
 * "Detalle por período": one row per cycle, oldest first, with the head count,
 * the self and manager completion, the mean of the valued (self, 1-4),
 * retention and engagement (manager, 1-5) answers with the people behind each
 * mean, and the share of goals completed. A figure direction cannot see
 * (under the minimum group size) is "Oculto"; one with nothing behind it "—".
 */
export function PeriodDetailTable({ data }: { data: PeriodDetail }) {
  const t = useTranslations("Completion.period");
  const format = useFormatter();
  const hidden = data.minGroupSize !== null;
  const empty = hidden ? t("hidden") : "—";
  const percent = (rate: number | null) =>
    rate === null ? empty : format.number(rate, { style: "percent" });
  const mean = (m: MeanOf | null) =>
    m === null ? (
      empty
    ) : (
      <>
        {format.number(m.mean, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
        <span className="text-xs text-muted-foreground">
          {" "}
          {t("people", { n: m.n })}
        </span>
      </>
    );
  const date = (iso: string) =>
    format.dateTime(new Date(`${iso}T00:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  if (!data.rows.length) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table
        aria-label={t("label")}
        className="min-w-full text-sm"
        data-testid="period-detail"
      >
        <thead>
          <tr className="text-left">
            {(
              [
                "cycle",
                "n",
                "self",
                "manager",
                "valued",
                "retention",
                "engagement",
                "goals",
              ] as const
            ).map((key) => (
              <th key={key} scope="col" className="p-1 font-medium">
                {t(`columns.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.cycleId} className="border-t" data-cycle={r.cycleId}>
              <th scope="row" className="p-1 text-left font-medium">
                {r.cycleName}
                <span className="block text-xs font-normal text-muted-foreground">
                  {date(r.periodStart)} – {date(r.periodEnd)}
                </span>
              </th>
              <td className="p-1 tabular-nums">{r.participants}</td>
              <td className="p-1 tabular-nums">{percent(r.selfRate)}</td>
              <td className="p-1 tabular-nums">{percent(r.managerRate)}</td>
              <td className="p-1 tabular-nums">{mean(r.valued)}</td>
              <td className="p-1 tabular-nums">{mean(r.retention)}</td>
              <td className="p-1 tabular-nums">{mean(r.engagement)}</td>
              <td className="p-1 tabular-nums">
                {r.goalsCompletedPct === null
                  ? empty
                  : format.number(r.goalsCompletedPct / 100, {
                      style: "percent",
                    })}
                {r.goals ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    {t("goalsOf", { n: r.goals })}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
