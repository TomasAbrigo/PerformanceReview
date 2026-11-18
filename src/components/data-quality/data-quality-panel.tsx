import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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

      {clear ? <p role="status">{t("allClear")}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {indicators.map((indicator) => {
          const title = t(`indicators.${indicator.key}.title`);
          return (
            <article
              key={indicator.key}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5"
            >
              <h2 className="text-lg">{title}</h2>
              <p className="text-sm text-muted-foreground">
                {t(`indicators.${indicator.key}.description`)}
              </p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <Badge
                  variant={indicator.count > 0 ? "destructive" : "success"}
                >
                  {t("count", { count: indicator.count })}
                </Badge>
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
