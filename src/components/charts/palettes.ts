/**
 * The sentiment palette, everywhere in this order (= stack and legend order):
 * positivo, constructivo, neutral, mixto, negativo. Validated with the
 * dataviz validator (CVD ΔE ≥ 15 between adjacent hues; neutral is the
 * gray midpoint). Ink is the readable text on each fill.
 */
export const SENTIMENT_COLORS = {
  positive: { fill: "bg-chart-sent-positive", ink: "text-white" },
  constructive: { fill: "bg-chart-sent-constructive", ink: "text-foreground" },
  neutral: { fill: "bg-chart-sent-neutral", ink: "text-foreground" },
  mixed: { fill: "bg-chart-sent-mixed", ink: "text-foreground" },
  negative: { fill: "bg-chart-sent-negative", ink: "text-white" },
} as const;
