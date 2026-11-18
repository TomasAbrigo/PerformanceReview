export type MatrixCell = {
  key: string;
  count: number | null;
  /** Quadrant name written in the cell ("En riesgo", "Comprometidos"...). */
  name: string;
  tip: string;
  highlight?: boolean;
};

/**
 * A 3×3 count matrix as a CSS grid: rows top to bottom, columns left to
 * right, axis titles with arrows, a band name per row/column, the quadrant
 * name and the count in each cell (shade = count, never the only cue), the
 * highlighted cell outlined. Cells are focusable with a tooltip.
 */
export function Matrix({
  rows,
  cols,
  cells,
  xTitle,
  yTitle,
  label,
  hiddenText = "–",
}: {
  rows: { key: string; name: string; range: string }[];
  cols: { key: string; name: string; range: string }[];
  /** cells[row][col]. */
  cells: MatrixCell[][];
  xTitle: string;
  yTitle: string;
  label: string;
  hiddenText?: string;
}) {
  const max = Math.max(1, ...cells.flat().map((c) => c.count ?? 0));
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-full max-w-xl flex-col gap-1"
      data-testid="matrix"
    >
      <span className="text-sm font-medium">↑ {yTitle}</span>
      <div className="grid grid-cols-[5.5rem_repeat(3,minmax(0,1fr))] gap-1">
        {rows.map((r, ri) => (
          <div key={r.key} className="contents">
            <div className="flex flex-col items-end justify-center pr-2 text-xs text-muted-foreground">
              <span>{r.name}</span>
              <span className="tabular-nums">{r.range}</span>
            </div>
            {cells[ri].map((c) => (
              <div
                key={c.key}
                tabIndex={0}
                role="img"
                aria-label={c.tip}
                data-tip={c.tip}
                data-testid="matrix-cell"
                className={`relative flex h-20 flex-col items-center justify-center rounded-md border outline-offset-1 focus-visible:outline-2 focus-visible:outline-ring ${
                  c.highlight
                    ? "border-2 border-chart-div-neg"
                    : "border-border"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-md ${c.highlight ? "bg-chart-div-neg" : "bg-chart-seq"}`}
                  style={{ opacity: 0.08 + 0.42 * ((c.count ?? 0) / max) }}
                />
                <span className="relative text-xs text-foreground-secondary">
                  {c.name}
                </span>
                <span className="relative text-xl font-semibold tabular-nums">
                  {c.count === null ? hiddenText : c.count}
                </span>
              </div>
            ))}
          </div>
        ))}
        <div />
        {cols.map((c) => (
          <div
            key={c.key}
            className="flex flex-col items-center text-xs text-muted-foreground"
          >
            <span>{c.name}</span>
            <span className="tabular-nums">{c.range}</span>
          </div>
        ))}
      </div>
      <span className="self-center pl-22 text-sm font-medium">{xTitle} →</span>
    </div>
  );
}
