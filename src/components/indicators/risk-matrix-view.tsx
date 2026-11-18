import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import { Matrix } from "@/components/charts";
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
        <div className="flex flex-col gap-2" data-testid="risk-list">
          <h3 className="font-sans text-sm font-medium">
            {t("matrix.risk.title")}
          </h3>
          {matrix.atRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("matrix.risk.empty")}
            </p>
          ) : (
            <CardCollection gridClassName="record-grid">
              {matrix.atRisk.map((p) => (
                <article key={p.personId} className="record-card">
                  <h4 className="text-lg">
                    <Link
                      href={`/insights/indicators/trend?person=${p.personId}`}
                      className="underline decoration-brand-200 underline-offset-4"
                    >
                      {p.name}
                    </Link>
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {p.department ?? t("none")} · {t("matrix.risk.manager")}:{" "}
                    {p.managerName ?? t("none")}
                  </p>
                  <dl className="record-facts">
                    <div>
                      <dt>{t("indicator.retention")}</dt>
                      <dd>
                        <span className="stat-value-sm">{p.retention}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>{t("indicator.engagement")}</dt>
                      <dd>
                        <span className="stat-value-sm">{p.engagement}</span>
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </CardCollection>
          )}
        </div>
      ) : null}
    </div>
  );
}
