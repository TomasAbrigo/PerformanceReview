import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { BulletBar, ChartFrame, type PanelKind } from "@/components/charts";

/** 0-1 -> whole percent. */
export const pct = (n: number | null | undefined) =>
  n == null ? null : Math.round(n * 100);

/**
 * A titled dashboard section: a white card on the fog background. It is the
 * chart kit's ChartFrame (title as the question, `hint` as how to read it,
 * `meta` with n and period) so every panel looks and behaves the same: a
 * header band over a white body, the icon of its `kind`, and `tone=
 * "highlight"` for the one to read first.
 */
export function Panel({
  id,
  title,
  hint,
  meta,
  actions,
  icon,
  kind,
  tone,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  meta?: string;
  actions?: ReactNode;
  /** The tile's icon: say what the panel holds when it is not a chart. */
  icon?: ReactNode;
  /** What it holds (distribution, trend, people, comments…): its icon. */
  kind?: PanelKind;
  tone?: "default" | "highlight";
  children: ReactNode;
}) {
  return (
    <ChartFrame
      id={id}
      title={title}
      howToRead={hint}
      meta={meta}
      icon={icon}
      kind={kind}
      tone={tone}
      actions={actions}
    >
      <div className="flex flex-col gap-4">{children}</div>
    </ChartFrame>
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

/** A completion meter: the kit's bullet bar (percent written next to it). */
export function Meter({
  value,
  label,
  width = 200,
  target,
  showValue = false,
}: {
  value: number;
  label: string;
  width?: number;
  target?: number | null;
  showValue?: boolean;
}) {
  return (
    <BulletBar
      value={value}
      label={label}
      width={width}
      target={target}
      showValue={showValue}
      fullLabel
    />
  );
}
