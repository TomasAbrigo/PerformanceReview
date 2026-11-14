import { useLocale, useTranslations } from "next-intl";
import type { SelfManagerGap } from "@/modules/analytics/dashboards/types";
import { Empty, pct, signedPts, TableView } from "./parts";

const W = 320;
const ROW = 22;

/**
 * Self vs manager gap per question: diverging bars from a gray zero line
 * (blue = manager higher, red = manager lower; validated pair), each bar
 * direct-labeled with its signed value, legend above, per-person table.
 */
export function GapChart({ data }: { data: SelfManagerGap }) {
  const t = useTranslations("Dashboards");
  const locale = useLocale() as "es" | "en";
  if (!data.byQuestion.length) return <Empty />;
  const mid = W / 2;
  const half = W / 2 - 28;
  const H = data.byQuestion.length * ROW + 4;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-4 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-chart-div-neg" />
          {t("gap.lower")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-chart-div-pos" />
          {t("gap.higher")}
        </span>
      </div>
      <div className="flex gap-3">
        <ul className="flex flex-col text-sm" style={{ gap: 0 }}>
          {data.byQuestion.map((q) => (
            <li
              key={q.questionRevisionId}
              className="max-w-64 truncate leading-[22px]"
              title={q.prompt[locale]}
            >
              {q.prompt[locale]}
            </li>
          ))}
        </ul>
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={data.byQuestion
            .map((q) =>
              t("gap.bar", {
                label: q.prompt[locale],
                gap: signedPts(q.meanGap),
              }),
            )
            .join(", ")}
        >
          <line
            x1={mid}
            x2={mid}
            y1={0}
            y2={H}
            strokeWidth={2}
            className="stroke-chart-div-mid"
          />
          {data.byQuestion.map((q, i) => {
            const len = Math.min(1, Math.abs(q.meanGap)) * half;
            const neg = q.meanGap < 0;
            const yTop = i * ROW + 5;
            return (
              <g key={q.questionRevisionId}>
                <title>
                  {t("gap.bar", {
                    label: q.prompt[locale],
                    gap: signedPts(q.meanGap),
                  })}
                </title>
                <rect
                  x={0}
                  y={i * ROW}
                  width={W}
                  height={ROW}
                  fill="transparent"
                />
                {len > 0 ? (
                  <rect
                    x={neg ? mid - len : mid}
                    y={yTop}
                    width={len}
                    height={12}
                    rx={4}
                    className={
                      neg ? "fill-chart-div-neg" : "fill-chart-div-pos"
                    }
                  />
                ) : null}
                <text
                  x={neg ? mid - len - 4 : mid + len + 4}
                  y={yTop + 10}
                  textAnchor={neg ? "end" : "start"}
                  className="fill-foreground text-[11px] tabular-nums"
                >
                  {signedPts(q.meanGap)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <TableView
        head={[
          t("gap.question"),
          t("gap.n"),
          t("gap.self"),
          t("gap.manager"),
          t("gap.gap"),
        ]}
        rows={data.byQuestion.map((q) => [
          q.prompt[locale],
          q.n,
          `${pct(q.meanSelf)} %`,
          `${pct(q.meanManager)} %`,
          signedPts(q.meanGap),
        ])}
      />
      {data.byPerson.length ? (
        <>
          <h3 className="text-sm font-medium">{t("gap.byPerson")}</h3>
          <table className="text-sm">
            <thead>
              <tr>
                <th className="p-1 text-left">{t("gap.person")}</th>
                <th className="p-1 text-left">{t("gap.n")}</th>
                <th className="p-1 text-left">{t("gap.gap")}</th>
              </tr>
            </thead>
            <tbody>
              {data.byPerson.map((p) => (
                <tr key={p.participantId} className="border-t">
                  <td className="p-1">{p.name}</td>
                  <td className="p-1 tabular-nums">{p.n}</td>
                  <td className="p-1 tabular-nums">{signedPts(p.meanGap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
