import { useFormatter, useTranslations } from "next-intl";
import { ChartTableToggle } from "@/components/charts";

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

/** The "view as table" fallback every chart carries: the kit's table toggle. */
export function TableView({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return <ChartTableToggle caption={head.join(", ")} table={{ head, rows }} />;
}
