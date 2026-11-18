import {
  Activity,
  ChartColumn,
  ChartNoAxesCombined,
  ChartScatter,
  CircleCheckBig,
  Grid3x3,
  List,
  MessagesSquare,
  Smile,
  Table2,
  Tags,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * What a panel holds; its icon says it at a glance, so not every panel wears
 * the same chart icon. Pass `kind` to Panel / ChartFrame (or `icon` for a
 * one-off).
 */
export const panelKinds = [
  "chart",
  "distribution",
  "trend",
  "matrix",
  "scatter",
  "list",
  "table",
  "people",
  "comments",
  "themes",
  "sentiment",
  "goals",
  "completion",
  "engagement",
] as const;
export type PanelKind = (typeof panelKinds)[number];

export const PANEL_ICONS: Record<PanelKind, LucideIcon> = {
  chart: ChartNoAxesCombined,
  distribution: ChartColumn,
  trend: TrendingUp,
  matrix: Grid3x3,
  scatter: ChartScatter,
  list: List,
  table: Table2,
  people: Users,
  comments: MessagesSquare,
  themes: Tags,
  sentiment: Smile,
  goals: Target,
  completion: CircleCheckBig,
  engagement: Activity,
};

export function PanelIcon({
  kind = "chart",
  className = "size-5",
}: {
  kind?: PanelKind;
  className?: string;
}) {
  const Icon = PANEL_ICONS[kind];
  return <Icon className={className} aria-hidden="true" data-kind={kind} />;
}
