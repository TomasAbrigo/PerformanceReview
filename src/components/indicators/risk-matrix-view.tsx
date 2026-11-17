import { useTranslations } from "next-intl";
import { Empty, TableView } from "@/components/dashboards/parts";
import { Link } from "@/i18n/navigation";
import {
  type Band,
  bandRange,
  bands,
  type RiskMatrix,
} from "@/modules/analytics/indicators/types";

const CELL_W = 96;
const CELL_H = 64;
const LEFT = 96;
const TOP = 8;
const W = LEFT + CELL_W * 3 + 8;
const H = TOP + CELL_H * 3 + 56;

/**
 * Retention × engagement in three bands per axis (retention left to right,
 * engagement bottom to top), the people of each cell counted; the risk cell
 * (both low) is outlined and labelled, not just coloured. People also gets
 * the list of the people in it.
 */
export function RiskMatrixView({ matrix }: { matrix: RiskMatrix }) {
  const t = useTranslations("Indicators");
  const cellOf = (retention: Band, engagement: Band) =>
    matrix.cells.find(
      (c) => c.retention === retention && c.engagement === engagement,
    )!;
  const bandLabel = (band: Band) => {
    const range = bandRange(band, matrix.riskThreshold);
    const text = !range
      ? "–"
      : range[0] === range[1]
        ? `${range[0]}`
        : `${range[0]}–${range[1]}`;
    return { name: t(`matrix.band.${band}`), range: text };
  };
  const max = Math.max(1, ...matrix.cells.map((c) => c.count ?? 0));
  const rowsTopDown = [...bands].reverse();
  const cellText = (retention: Band, engagement: Band) => {
    const c = cellOf(retention, engagement);
    const names = {
      retention: bandLabel(retention).name,
      engagement: bandLabel(engagement).name,
    };
    return c.count === null
      ? t("matrix.cellHidden", { ...names, min: matrix.minGroupSize ?? 0 })
      : t("matrix.cell", { ...names, count: c.count });
  };
  const hasAny = matrix.cells.some((c) => c.count !== 0);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" data-testid="matrix-summary">
        {matrix.total === null
          ? t("matrix.totalHidden")
          : t("matrix.total", { n: matrix.total })}
        {matrix.riskCount === null
          ? ""
          : ` · ${t("matrix.riskCount", { n: matrix.riskCount })}`}
      </p>
      {hasAny || matrix.suppressed ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full max-w-md"
          role="img"
          aria-label={`${t("matrix.title")}: ${bands
            .flatMap((r) => bands.map((e) => cellText(r, e)))
            .join("; ")}`}
        >
          {rowsTopDown.map((engagement, row) =>
            bands.map((retention, col) => {
              const c = cellOf(retention, engagement);
              const x = LEFT + col * CELL_W;
              const y = TOP + row * CELL_H;
              return (
                <g key={`${retention}-${engagement}`}>
                  <title>{cellText(retention, engagement)}</title>
                  <rect
                    x={x + 2}
                    y={y + 2}
                    width={CELL_W - 4}
                    height={CELL_H - 4}
                    rx={4}
                    className={
                      c.risk
                        ? "fill-chart-div-neg stroke-chart-div-neg"
                        : "fill-chart-seq stroke-border"
                    }
                    fillOpacity={0.12 + 0.55 * ((c.count ?? 0) / max)}
                    strokeWidth={c.risk ? 2 : 1}
                  />
                  <text
                    x={x + CELL_W / 2}
                    y={y + CELL_H / 2 + 6}
                    textAnchor="middle"
                    className="fill-foreground text-[18px] font-semibold tabular-nums"
                  >
                    {c.count === null ? "–" : c.count}
                  </text>
                  {c.risk ? (
                    <text
                      x={x + CELL_W / 2}
                      y={y + 16}
                      textAnchor="middle"
                      className="fill-foreground text-[10px] font-medium"
                    >
                      {t("matrix.risk.label")}
                    </text>
                  ) : null}
                </g>
              );
            }),
          )}
          {rowsTopDown.map((engagement, row) => {
            const l = bandLabel(engagement);
            const y = TOP + row * CELL_H + CELL_H / 2;
            return (
              <text
                key={engagement}
                x={LEFT - 8}
                y={y}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                <tspan x={LEFT - 8} dy="-0.2em">
                  {l.name}
                </tspan>
                <tspan x={LEFT - 8} dy="1.2em">
                  {l.range}
                </tspan>
              </text>
            );
          })}
          {bands.map((retention, col) => {
            const l = bandLabel(retention);
            const x = LEFT + col * CELL_W + CELL_W / 2;
            return (
              <text
                key={retention}
                x={x}
                y={TOP + CELL_H * 3 + 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                <tspan x={x}>{l.name}</tspan>
                <tspan x={x} dy="1.2em">
                  {l.range}
                </tspan>
              </text>
            );
          })}
          <text
            x={LEFT + (CELL_W * 3) / 2}
            y={H - 6}
            textAnchor="middle"
            className="fill-foreground text-[11px] font-medium"
          >
            {t("indicator.retention")} →
          </text>
          <text
            x={8}
            y={TOP + 4}
            className="fill-foreground text-[11px] font-medium"
          >
            ↑ {t("indicator.engagement")}
          </text>
        </svg>
      ) : (
        <Empty />
      )}
      {matrix.suppressed && matrix.minGroupSize !== null ? (
        <p className="text-sm text-muted-foreground">
          {t("matrix.suppressed", { min: matrix.minGroupSize })}
        </p>
      ) : null}
      {hasAny || matrix.suppressed ? (
        <TableView
          head={[
            `${t("indicator.engagement")} / ${t("indicator.retention")}`,
            ...bands.map((b) => bandLabel(b).name),
          ]}
          rows={rowsTopDown.map((engagement) => [
            bandLabel(engagement).name,
            ...bands.map((retention) => {
              const c = cellOf(retention, engagement).count;
              return c === null ? "–" : c;
            }),
          ])}
        />
      ) : null}
      {matrix.atRisk ? (
        <div className="flex flex-col gap-2" data-testid="risk-list">
          <h3 className="font-medium">{t("matrix.risk.title")}</h3>
          {matrix.atRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("matrix.risk.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr>
                    <th className="p-1 text-left">{t("matrix.risk.person")}</th>
                    <th className="p-1 text-left">
                      {t("matrix.risk.manager")}
                    </th>
                    <th className="p-1 text-left">
                      {t("matrix.risk.department")}
                    </th>
                    <th className="p-1 text-left">
                      {t("indicator.retention")}
                    </th>
                    <th className="p-1 text-left">
                      {t("indicator.engagement")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.atRisk.map((p) => (
                    <tr key={p.personId} className="border-t">
                      <td className="p-1">
                        <Link
                          href={`/insights/indicators/trend?person=${p.personId}`}
                          className="underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="p-1">{p.managerName ?? t("none")}</td>
                      <td className="p-1">{p.department ?? t("none")}</td>
                      <td className="p-1 tabular-nums">{p.retention}</td>
                      <td className="p-1 tabular-nums">{p.engagement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
