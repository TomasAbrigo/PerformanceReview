import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { CheckCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import { IconTile, EmptyState } from "@/components/experience";
import { Link } from "@/i18n/navigation";
import type {
  DataQualityIndicator,
  DataQualityKey,
} from "@/modules/analytics/data-quality";

/** Where the cases of an indicator are listed: the identity queue has its own screen. */
export const indicatorHref = (key: DataQualityKey) =>
  key === "identity_open" ? "/imports/identity" : `/data-quality/${key}`;

const IDENTITY_KINDS = [
  "employee",
  "assessment",
  "assessment_progress",
  "feedback",
  "org_attribute",
  "engagement",
] as const;
type IdentityKind = (typeof IDENTITY_KINDS)[number] | "other";

/** Open identity cases by kind: missing employees are not held-back report rows (#132). */
function IdentityKinds({ items }: { items: { entity: string }[] }) {
  const t = useTranslations("DataQuality");
  const counts = new Map<IdentityKind, number>();
  for (const { entity } of items) {
    const kind: IdentityKind = (IDENTITY_KINDS as readonly string[]).includes(
      entity,
    )
      ? (entity as IdentityKind)
      : "other";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return (
    <ul className="text-xs text-muted-foreground">
      {[...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([kind, n]) => (
          <li key={kind}>{`${t(`identityEntities.${kind}`)}: ${n}`}</li>
        ))}
    </ul>
  );
}

function IndicatorCard({ indicator }: { indicator: DataQualityIndicator }) {
  const t = useTranslations("DataQuality");
  const title = t(`indicators.${indicator.key}.title`);
  const open = indicator.count > 0;
  return (
    <article className="metric-card" data-open={open ? "true" : "false"}>
      <IconTile>{open ? <ShieldAlert /> : <CheckCheck />}</IconTile>
      <h2 className="text-lg">{title}</h2>
      <p className="text-sm text-muted-foreground">
        {t(`indicators.${indicator.key}.description`)}
      </p>
      {indicator.key === "identity_open" && indicator.count > 0 ? (
        <IdentityKinds items={indicator.items} />
      ) : null}
      <p
        className={`stat-value ${open ? "text-status-pending" : ""}`}
        aria-label={t("count", { count: indicator.count })}
      >
        {indicator.count}
      </p>
      <p className="text-xs text-muted-foreground">
        {open ? t("needsReview") : t("ok")}
        {open ? (
          <span className="ml-2">{t("count", { count: indicator.count })}</span>
        ) : null}
      </p>
      <div className="mt-auto pt-2">
        {open ? (
          <Link
            href={indicatorHref(indicator.key)}
            aria-label={t("viewCasesOf", { title })}
            className="button-outline"
          >
            {t("viewCases")} →
          </Link>
        ) : (
          <span className="button-outline opacity-60" aria-disabled="true">
            {t("noCases")}
          </span>
        )}
      </div>
    </article>
  );
}

/**
 * The data-quality panel, as the canvas draws it: a notice with the total of
 * cases to review, one card per indicator with cases, and the indicators
 * without cases folded under a disclosure (still there, one click away).
 */
export function DataQualityPanel({
  indicators,
}: {
  indicators: DataQualityIndicator[];
}) {
  const t = useTranslations("DataQuality");
  const tHome = useTranslations("Home");
  // The biggest problems first.
  const open = indicators
    .filter((i) => i.count > 0)
    .sort((a, b) => b.count - a.count);
  const clear = indicators.filter((i) => i.count === 0);
  const cases = open.reduce((sum, i) => sum + i.count, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={tHome("groups.data")}
        title={t("title")}
        description={t("description")}
      />

      {open.length === 0 ? (
        <EmptyState icon={<CheckCheck />}>{t("allClear")}</EmptyState>
      ) : (
        <aside className="dq-notice" role="status">
          <IconTile>
            <ShieldCheck className="size-5" />
          </IconTile>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-medium">{t("pending", { n: cases })}</p>
            <p className="text-sm text-muted-foreground">{t("pendingHint")}</p>
          </div>
        </aside>
      )}

      {open.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {open.map((indicator) => (
            <IndicatorCard key={indicator.key} indicator={indicator} />
          ))}
        </div>
      ) : null}

      {clear.length > 0 ? (
        <details className="collection-more" open={open.length === 0}>
          <summary className="button-outline">
            {t("showAll", { n: clear.length })}
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clear.map((indicator) => (
              <IndicatorCard key={indicator.key} indicator={indicator} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
