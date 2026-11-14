"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { Distribution } from "@/modules/review-core/calibration";

export type DistributionData = {
  department: { manager: Distribution; current: Distribution };
  manager: { manager: Distribution; current: Distribution };
};

const BAR_W = 28;
const GAP = 8;
const H = 96;

/**
 * Rating distribution of a cycle (no forced curve), per dataviz skill: one
 * small multiple per department/manager (single sequential hue, so no
 * categorical palette), shared y-scale, 4px rounded bar tops on the
 * baseline, direct count labels, a hover tooltip per bar (title) and the
 * same numbers in a table. Toggles: group by and pre (manager) vs post
 * (current rating).
 */
export function DistributionChart({ data }: { data: DistributionData }) {
  const t = useTranslations("Calibration");
  const locale = useLocale() as "es" | "en";
  const [groupBy, setGroupBy] = useState<"department" | "manager">(
    "department",
  );
  const [stage, setStage] = useState<"manager" | "current">("current");
  const d = data[groupBy][stage];
  const max = Math.max(1, ...d.series.flatMap((s) => s.counts));
  const width = d.options.length * (BAR_W + GAP);
  const toggle = (active: boolean) =>
    `rounded-md border px-2 py-1 text-sm ${active ? "bg-foreground text-background" : ""}`;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="dist-title">
      <h2 id="dist-title" className="text-lg font-semibold">
        {t("distribution")}
      </h2>
      <div className="flex flex-wrap gap-4">
        <div role="group" aria-label={t("groupBy")} className="flex gap-1">
          {(["department", "manager"] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={groupBy === g}
              className={toggle(groupBy === g)}
              onClick={() => setGroupBy(g)}
            >
              {t(`by.${g}`)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t("stage")} className="flex gap-1">
          {(["manager", "current"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={stage === s}
              className={toggle(stage === s)}
              onClick={() => setStage(s)}
            >
              {t(`stages.${s}`)}
            </button>
          ))}
        </div>
      </div>
      {d.series.length === 0 ? (
        <p className="text-muted-foreground">{t("noRatings")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-6">
            {d.series.map((s) => (
              <figure
                key={s.key ?? "none"}
                className="flex flex-col gap-1"
                data-testid="histogram"
              >
                <figcaption className="text-sm font-medium">
                  {s.label ?? t("none")}
                </figcaption>
                <svg
                  width={width}
                  height={H + 32}
                  role="img"
                  aria-label={`${s.label ?? t("none")}: ${d.options
                    .map((o, i) => `${o.label[locale]} ${s.counts[i]}`)
                    .join(", ")}`}
                >
                  <line
                    x1={0}
                    x2={width}
                    y1={H + 14}
                    y2={H + 14}
                    className="stroke-border"
                  />
                  {d.options.map((o, i) => {
                    const h = (s.counts[i] / max) * H;
                    const x = i * (BAR_W + GAP) + GAP / 2;
                    return (
                      <g key={o.value}>
                        <title>{`${o.label[locale]}: ${s.counts[i]}`}</title>
                        {/* Hit target bigger than the mark. */}
                        <rect
                          x={x - GAP / 2}
                          y={0}
                          width={BAR_W + GAP}
                          height={H + 30}
                          fill="transparent"
                        />
                        {h > 0 ? (
                          <path
                            className="fill-chart-seq"
                            d={`M${x},${H + 14} v${-(h - 4)} q0,-4 4,-4 h${BAR_W - 8} q4,0 4,4 v${h - 4} z`}
                          />
                        ) : null}
                        <text
                          x={x + BAR_W / 2}
                          y={H + 10 - h}
                          textAnchor="middle"
                          className="fill-foreground text-[11px] tabular-nums"
                        >
                          {s.counts[i]}
                        </text>
                        <text
                          x={x + BAR_W / 2}
                          y={H + 28}
                          textAnchor="middle"
                          className="fill-muted-foreground text-[11px]"
                        >
                          {o.value}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </figure>
            ))}
          </div>
          <details>
            <summary className="cursor-pointer text-sm">
              {t("tableView")}
            </summary>
            <table className="mt-2 text-sm">
              <thead>
                <tr>
                  <th className="p-1 text-left">{t(`by.${groupBy}`)}</th>
                  {d.options.map((o) => (
                    <th key={o.value} className="p-1">
                      {o.value} · {o.label[locale]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.series.map((s) => (
                  <tr key={s.key ?? "none"}>
                    <td className="p-1">{s.label ?? t("none")}</td>
                    {s.counts.map((c, i) => (
                      <td key={i} className="p-1 text-center tabular-nums">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
