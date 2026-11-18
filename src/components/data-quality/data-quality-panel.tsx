import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { CheckCheck, ShieldAlert } from "lucide-react";
import { IconTile, EmptyState } from "@/components/experience";
import { Link } from "@/i18n/navigation";
import type {
  DataQualityIndicator,
  DataQualityKey,
} from "@/modules/analytics/data-quality";

/** Where the cases of an indicator are listed: the identity queue has its own screen. */
export const indicatorHref = (key: DataQualityKey) =>
  key === "identity_open" ? "/imports/identity" : `/data-quality/${key}`;

export function DataQualityPanel({
  indicators,
}: {
  indicators: DataQualityIndicator[];
}) {
  const t = useTranslations("DataQuality");
  const tHome = useTranslations("Home");
  const clear = indicators.every((i) => i.count === 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={tHome("groups.data")}
        title={t("title")}
        description={t("description")}
      />

      {clear ? (
        <EmptyState icon={<CheckCheck />}>{t("allClear")}</EmptyState>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {indicators.map((indicator) => {
          const title = t(`indicators.${indicator.key}.title`);
          return (
            <article key={indicator.key} className="metric-card">
              <div className="flex items-center justify-between">
                <IconTile>
                  {indicator.count > 0 ? <ShieldAlert /> : <CheckCheck />}
                </IconTile>
                <span className="stat-value">{indicator.count}</span>
              </div>
              <h2 className="text-lg">{title}</h2>
              <p className="text-sm text-muted-foreground">
                {t(`indicators.${indicator.key}.description`)}
              </p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <span className="text-sm text-muted-foreground">
                  {t("count", { count: indicator.count })}
                </span>
                {indicator.count > 0 ? (
                  <Link
                    href={indicatorHref(indicator.key)}
                    aria-label={t("viewCasesOf", { title })}
                    className="text-sm underline"
                  >
                    {t("viewCases")}
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
