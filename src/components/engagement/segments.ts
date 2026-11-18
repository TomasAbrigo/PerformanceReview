import { engagementSegments } from "@/modules/engagement/kinds";

/** One color per segment, from the sentiment palette (green, teal, amber, red, grey); text always says which. */
export const SEGMENT_FILL: Record<(typeof engagementSegments)[number], string> =
  {
    alto: "fill-chart-sent-positive",
    medio: "fill-chart-sent-constructive",
    regular: "fill-chart-sent-mixed",
    bajo: "fill-chart-sent-negative",
    falta: "fill-chart-sent-neutral",
  };
export const SEGMENT_SWATCH: Record<
  (typeof engagementSegments)[number],
  string
> = {
  alto: "bg-chart-sent-positive",
  medio: "bg-chart-sent-constructive",
  regular: "bg-chart-sent-mixed",
  bajo: "bg-chart-sent-negative",
  falta: "bg-chart-sent-neutral",
};
