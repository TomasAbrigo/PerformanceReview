import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import { Matrix } from "@/components/charts";
import type { DrillBase } from "@/components/drill/drill-link";
import { Empty, TableView } from "@/components/insights/parts";
import { Link } from "@/i18n/navigation";
import {
  type Band,
  bandRange,
  bands,
  type RiskMatrix,
} from "@/modules/analytics/indicators/types";

/**
 * Retention × engagement in three bands per axis (retention left to right,
 * engagement bottom to top), the people of each cell counted; the risk cell
 * (both low) is outlined and labelled, not just coloured. People also gets
 * the list of the people in it. With `drill`, every cell with people opens
 * them (direction: their counts by area) in the drill sheet.
 */
export function RiskMatrixView({
  matrix,
  drill,
}: {
  matrix: RiskMatrix;
  drill?: DrillBase;
}) {
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
        <Matrix
          label={t("matrix.chart")}
          xTitle={t("indicator.retention")}
          yTitle={t("indicator.engagement")}
          rows={rowsTopDown.map((b) => ({ key: b, ...bandLabel(b) }))}
          cols={bands.map((b) => ({ key: b, ...bandLabel(b) }))}
          cells={rowsTopDown.map((engagement) =>
            bands.map((retention) => {
              const c = cellOf(retention, engagement);
              return {
                key: `${retention}-${engagement}`,
                count: c.count,
                name: t(`matrix.quadrant.${retention}.${engagement}`),
                tip: cellText(retention, engagement),
                highlight: c.risk,
                drill:
                  drill && c.count
                    ? {
                        base: drill,
                        drill: {
                          kind: "risk" as const,
                          retention,
                          engagement,
                        },
                      }
                    : undefined,
              };
            }),
          )}
        />
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
        <details className="flex flex-col gap-2" data-testid="risk-list">
          <summary className="button-outline w-fit cursor-pointer">
            {t("matrix.risk.title")} ({matrix.atRisk.length})
          </summary>
          {matrix.atRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("matrix.risk.empty")}
            </p>
          ) : (
            <CardCollection gridClassName="dense-list" initialCount={10}>
              {matrix.atRisk.map((p) => (
                <article
                  key={p.personId}
                  className="dense-row"
                  aria-label={p.name}
                >
                  <div className="dense-name">
                    <Link
                      href={`/insights/indicators/trend?person=${p.personId}`}
                      className="font-medium"
                    >
                      {p.name}
                    </Link>
                    <small>
                      {p.department ?? t("none")} · {t("matrix.risk.manager")}:{" "}
                      {p.managerName ?? t("none")}
                    </small>
                  </div>
                  <dl className="dense-facts">
                    <div>
                      <dt>{t("indicator.retention")}</dt>
                      <dd>{p.retention}</dd>
                    </div>
                    <div>
                      <dt>{t("indicator.engagement")}</dt>
                      <dd>{p.engagement}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </CardCollection>
          )}
        </details>
      ) : null}
    </div>
  );
}
