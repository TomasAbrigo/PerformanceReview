import { ChartNoAxesCombined } from "lucide-react";
import { EmptyState, IconTile } from "@/components/experience";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChartTooltip } from "./chart-tooltip";

export type LegendItem = {
  key: string;
  label: string;
  /** Tailwind bg class of the swatch. */
  swatch: string;
  /** Line legend: a dashed stroke instead of a block. */
  dashed?: boolean;
  line?: boolean;
};

export type ChartTable = {
  head: ReactNode[];
  rows: ReactNode[][];
};

/** Legend in the same order as the stack / series. */
export function ChartLegend({
  items,
  label,
}: {
  items: LegendItem[];
  label?: string;
}) {
  const t = useTranslations("Charts");
  return (
    <ul
      aria-label={label ?? t("legend")}
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-secondary"
      data-testid="chart-legend"
    >
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          {i.line ? (
            <span
              aria-hidden="true"
              className={`inline-block h-0 w-5 border-t-2 ${i.dashed ? "border-dashed" : ""} ${i.swatch}`}
            />
          ) : (
            <span
              aria-hidden="true"
              className={`inline-block size-3 rounded-sm ${i.swatch}`}
            />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** The accessible table twin of a chart, behind "Ver como tabla". */
export function ChartTableToggle({
  table,
  caption,
}: {
  table: ChartTable;
  caption: string;
}) {
  const t = useTranslations("Charts");
  return (
    <details className="group text-sm" data-testid="chart-table">
      <summary className="cursor-pointer text-sm text-primary">
        {t("tableView")}
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {table.head.map((h, i) => (
                <th
                  key={i}
                  scope="col"
                  className="p-1 pr-4 text-left font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className="border-t">
                {r.map((c, j) =>
                  j === 0 ? (
                    <th
                      key={j}
                      scope="row"
                      className="p-1 pr-4 text-left font-normal"
                    >
                      {c}
                    </th>
                  ) : (
                    <td key={j} className="p-1 pr-4 tabular-nums">
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Every chart's frame: the question it answers as title, a one-line "how to
 * read it", n and period, the takeaway, the legend (stack order), the chart
 * with hover/focus tooltips, an explained empty/masked state and the table.
 * `level` 2 renders a card section (replaces Panel); 3 a nested figure.
 */
export function ChartFrame({
  id,
  title,
  howToRead,
  meta,
  takeaway,
  legend,
  table,
  empty,
  actions,
  level = 2,
  children,
}: {
  id: string;
  title: string;
  howToRead?: string;
  /** n and period, already formatted ("n = 277 · Evaluación 2026"). */
  meta?: string;
  takeaway?: ReactNode;
  legend?: LegendItem[];
  table?: ChartTable;
  /** When set, replaces the chart: why there is nothing to show. */
  empty?: string | null;
  actions?: ReactNode;
  level?: 2 | 3;
  children?: ReactNode;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  const body = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {level === 2 ? (
            <IconTile>
              <ChartNoAxesCombined className="size-5" />
            </IconTile>
          ) : null}
          <Heading
            id={`${id}-title`}
            className={level === 3 ? "text-lg" : undefined}
          >
            {title}
          </Heading>
          {howToRead ? (
            <p
              className="max-w-3xl text-sm text-muted-foreground"
              data-testid="chart-how"
            >
              {howToRead}
            </p>
          ) : null}
          {meta ? (
            <p
              className="text-xs text-muted-foreground tabular-nums"
              data-testid="chart-meta"
            >
              {meta}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      {empty ? (
        <div data-testid="chart-empty">
          <EmptyState>{empty}</EmptyState>
        </div>
      ) : (
        <>
          {takeaway ? (
            <p className="insight-callout" data-testid="chart-takeaway">
              {takeaway}
            </p>
          ) : null}
          {legend && legend.length > 1 ? <ChartLegend items={legend} /> : null}
          <ChartTooltip>{children}</ChartTooltip>
          {table ? <ChartTableToggle table={table} caption={title} /> : null}
        </>
      )}
    </>
  );
  return level === 2 ? (
    <section
      aria-labelledby={`${id}-title`}
      className="chart-panel"
      data-testid={id}
    >
      {body}
    </section>
  ) : (
    <figure
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-3"
      data-testid={id}
    >
      {body}
    </figure>
  );
}
