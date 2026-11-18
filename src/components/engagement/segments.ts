import { engagementSegments } from "@/modules/engagement/kinds";

/**
 * One color per segment, from the sentiment palette (green, teal, amber,
 * red, gray) in stack order; labels and tooltips always say which.
 */
export const SEGMENT_COLORS: Record<
  (typeof engagementSegments)[number],
  { fill: string; ink: string }
> = {
  alto: { fill: "bg-chart-sent-positive", ink: "text-white" },
  medio: { fill: "bg-chart-sent-constructive", ink: "text-foreground" },
  regular: { fill: "bg-chart-sent-mixed", ink: "text-foreground" },
  bajo: { fill: "bg-chart-sent-negative", ink: "text-white" },
  falta: { fill: "bg-chart-sent-neutral", ink: "text-foreground" },
};
export const SEGMENT_SWATCH = Object.fromEntries(
  Object.entries(SEGMENT_COLORS).map(([k, v]) => [k, v.fill]),
) as Record<(typeof engagementSegments)[number], string>;
