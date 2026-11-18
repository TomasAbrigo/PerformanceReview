import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  DRILL_PARAM,
  type Drill,
  formatDrill,
} from "@/modules/insights/drill-spec";

/**
 * Where the page is: its path (without locale) and its search params, as the
 * page received them. Serializable, so server and client charts take it.
 */
export type DrillBase = {
  pathname: string;
  query: Record<string, string | string[] | undefined>;
};

/** The page's URL with `drill` set (or removed with null), other params kept. */
export function drillHref(base: DrillBase, drill: Drill | null): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(base.query)) {
    if (k === DRILL_PARAM || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  if (drill) q.set(DRILL_PARAM, formatDrill(drill));
  const qs = q.toString();
  return qs ? `${base.pathname}?${qs}` : base.pathname;
}

/**
 * A chart mark, KPI or row that opens the records behind it in the drill
 * sheet: a real link (Enter and click work, it can be opened in a new tab
 * or shared), `aria-haspopup="dialog"` because it opens one, no scroll jump.
 * `label` is its accessible name: say what opens ("Ver las 3 personas con
 * retención 2").
 */
export function DrillLink({
  base,
  drill,
  label,
  className,
  style,
  testId,
  children,
}: {
  base: DrillBase;
  drill: Drill;
  label: string;
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={drillHref(base, drill)}
      scroll={false}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      data-drill={formatDrill(drill)}
      data-testid={testId}
      style={style}
      className={cn("drill-target", className)}
    >
      {children}
    </Link>
  );
}
