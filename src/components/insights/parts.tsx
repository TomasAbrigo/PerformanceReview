import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

/** 0-1 -> whole percent. */
export const pct = (n: number | null | undefined) =>
  n == null ? null : Math.round(n * 100);

/** A titled dashboard section: a white card on the fog background. */
export function Panel({
  id,
  title,
  hint,
  actions,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 lg:p-6"
      data-testid={id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-title`}>{title}</h2>
          {hint ? (
            <p className="max-w-3xl text-sm text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** The "view as table" fallback every chart carries (dataviz: a11y). */
export function TableView({
  head,
  rows,
}: {
  head: ReactNode[];
  rows: ReactNode[][];
}) {
  const t = useTranslations("Charts");
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm">{t("tableView")}</summary>
      <div className="mt-3 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i} className="pr-4 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="pr-4 tabular-nums">
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

export function Empty() {
  const t = useTranslations("Charts");
  return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
}

/** Horizontal meter (single sequential hue), 4px rounded data end. */
export function Meter({
  value,
  label,
  width = 200,
}: {
  value: number;
  label: string;
  width?: number;
}) {
  const w = Math.max(0, Math.min(1, value)) * width;
  return (
    <svg width={width} height={8} role="img" aria-label={label}>
      <title>{label}</title>
      <rect width={width} height={8} rx={4} className="fill-brand-200/60" />
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
