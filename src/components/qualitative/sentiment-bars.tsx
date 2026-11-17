import { useTranslations } from "next-intl";
import {
  sentiments,
  type Sentiment,
} from "@/modules/qualitative-analysis/constants";
import type { SentimentCounts } from "@/modules/qualitative-analysis/types";

const FILL: Record<Sentiment, string> = {
  positive: "fill-chart-div-pos",
  constructive: "fill-chart-div-mid",
  negative: "fill-chart-div-neg",
};
const SWATCH: Record<Sentiment, string> = {
  positive: "bg-chart-div-pos",
  constructive: "bg-chart-div-mid",
  negative: "bg-chart-div-neg",
};

export type StackedRow = SentimentCounts & { key: string; label: string };

const W = 320;
const ROW = 28;
const LABEL_W = 160;

/**
 * 100% stacked horizontal bars of sentiment (diverging palette: positive and
 * negative at the ends, constructive neutral in the middle), counts inside
 * each segment and a tooltip per bar.
 */
export function SentimentBars({
  rows,
  label,
}: {
  rows: StackedRow[];
  label: string;
}) {
  const t = useTranslations("Qualitative");
  return (
    <div className="flex flex-col gap-2">
      <Legend />
      <svg
        role="img"
        aria-label={label}
        width="100%"
        viewBox={`0 0 ${LABEL_W + W + 40} ${rows.length * ROW + 4}`}
        className="max-w-2xl"
      >
        {rows.map((r, i) => {
          let x = LABEL_W;
          const y = i * ROW + 2;
          return (
            <g key={r.key} data-testid="sentiment-bar">
              <title>
                {t("byDimension.bar", {
                  label: r.label,
                  positive: r.positive,
                  constructive: r.constructive,
                  negative: r.negative,
                })}
              </title>
              <text
                x={LABEL_W - 8}
                y={y + 16}
                textAnchor="end"
                className="fill-foreground text-[11px]"
              >
                {r.label}
              </text>
              {sentiments.map((s) => {
                const w = r.total ? (r[s] / r.total) * W : 0;
                const seg = (
                  <g key={s}>
                    {w > 0 ? (
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={ROW - 8}
                        className={`${FILL[s]} stroke-background`}
                        strokeWidth={1}
                      />
                    ) : null}
                    {w >= 18 ? (
                      <text
                        x={x + w / 2}
                        y={y + 14}
                        textAnchor="middle"
                        className={`text-[10px] tabular-nums ${s === "constructive" ? "fill-foreground" : "fill-white"}`}
                      >
                        {r[s]}
                      </text>
                    ) : null}
                  </g>
                );
                x += w;
                return seg;
              })}
              <text
                x={LABEL_W + W + 6}
                y={y + 14}
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {r.total}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Legend() {
  const t = useTranslations("Qualitative.sentiment");
  return (
    <ul className="flex gap-3 text-xs">
      {sentiments.map((s) => (
        <li key={s} className="flex items-center gap-1">
          <span
            className={`inline-block size-3 rounded-sm border ${SWATCH[s]}`}
          />
          {t(s)}
        </li>
      ))}
    </ul>
  );
}
