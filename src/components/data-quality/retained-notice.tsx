import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * "N assessments held back by identity in this cycle" (#132): rows of the
 * report whose person was not identified are in no analysis until resolved.
 * Rendered for People only; nothing when there are none.
 */
export function RetainedNotice({ count }: { count: number }) {
  const t = useTranslations("DataQuality");
  if (count <= 0) return null;
  return (
    <aside className="dq-notice" role="status">
      <p className="text-sm">
        {t("retainedInsights", { n: count })}{" "}
        <Link href="/data-quality/identity_retained_rows" className="underline">
          {t("retainedInsightsLink")}
        </Link>
      </p>
    </aside>
  );
}
