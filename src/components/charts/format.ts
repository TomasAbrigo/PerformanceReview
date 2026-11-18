import { useFormatter } from "next-intl";

/**
 * Number formatting shared by every chart: shares as whole percents
 * ("72 %" in es, "72%" in en), means with one decimal at most, counts as
 * integers. Locale comes from next-intl.
 */
export function useChartFormat() {
  const format = useFormatter();
  return {
    /** A 0-1 share as a whole percent. */
    share: (v: number) =>
      format.number(v, { style: "percent", maximumFractionDigits: 0 }),
    /** A 0-100 value as a whole percent. */
    percent: (v: number) =>
      format.number(v / 100, { style: "percent", maximumFractionDigits: 0 }),
    /** A mean: one decimal at most ("3,7"). */
    decimal: (v: number) =>
      format.number(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    int: (v: number) => format.number(Math.round(v)),
  };
}
export type ChartFormat = ReturnType<typeof useChartFormat>;
