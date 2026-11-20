import { engagementSegments } from "@/modules/engagement/kinds";

/**
 * One color per segment (#133): a single teal scale from alto (darkest) to
 * bajo (lightest), never the sentiment palette (a segment is not a mood), and
 * "falta" (no answer) its own pale gray, not the neutral of a sentiment.
 * Labels and tooltips always say which.
 */
export const SEGMENT_COLORS: Record<
  (typeof engagementSegments)[number],
  { fill: string; ink: string }
> = {
  alto: { fill: "bg-chart-1", ink: "text-white" },
  medio: { fill: "bg-chart-3", ink: "text-white" },
  regular: { fill: "bg-chart-4", ink: "text-foreground" },
  bajo: { fill: "bg-chart-5", ink: "text-foreground" },
  falta: {
    fill: "bg-chart-missing border border-dashed border-muted-foreground/40",
    ink: "text-muted-foreground",
  },
};
export const SEGMENT_SWATCH = Object.fromEntries(
  Object.entries(SEGMENT_COLORS).map(([k, v]) => [k, v.fill]),
) as Record<(typeof engagementSegments)[number], string>;
