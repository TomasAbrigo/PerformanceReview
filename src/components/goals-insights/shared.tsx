import { useFormatter, useTranslations } from "next-intl";

/** A whole percentage, or a dash without a value. */
export function usePct() {
  const format = useFormatter();
  return (value: number | null | undefined) =>
    value == null ? null : format.number(Math.round(value));
}

/** A number with at most one decimal (means), or a dash without a value. */
export function useDecimal() {
  const format = useFormatter();
  return (value: number | null | undefined) =>
    value == null ? null : format.number(value, { maximumFractionDigits: 1 });
}

export function Empty() {
  const t = useTranslations("GoalsInsights");
  return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
}

/** The "view as table" fallback every chart carries (dataviz: a11y). */
export function TableView({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  const t = useTranslations("GoalsInsights");
  return (
    <details>
      <summary className="cursor-pointer text-sm">{t("tableView")}</summary>
      <div className="overflow-x-auto">
        <table className="mt-2 text-sm">
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className="p-1 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((c, j) => (
                  <td key={j} className="p-1 tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
