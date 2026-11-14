import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

/** 0-1 -> whole percent. */
export const pct = (n: number | null | undefined) =>
  n == null ? null : Math.round(n * 100);

/** Signed normalized points (gap): -0.25 -> "-25". */
export const signedPts = (n: number) => {
  const v = Math.round(n * 100);
  return v > 0 ? `+${v}` : `${v}`;
};

/** A titled dashboard section. */
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
      className="flex flex-col gap-3 rounded-lg border p-4"
      data-testid={id}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        {actions}
      </div>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
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
  const t = useTranslations("Dashboards");
  return (
    <details>
      <summary className="cursor-pointer text-sm">{t("tableView")}</summary>
      <div className="overflow-x-auto">
        <table className="mt-2 text-sm">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i} className="p-1 text-left font-medium">
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

export function Empty() {
  const t = useTranslations("Dashboards");
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
    <svg width={width} height={10} role="img" aria-label={label}>
      <title>{label}</title>
      <rect width={width} height={10} rx={4} className="fill-muted" />
      {w > 0 ? (
        <rect
          width={Math.max(w, 8)}
          height={10}
          rx={4}
          className="fill-chart-seq"
        />
      ) : null}
    </svg>
  );
}
