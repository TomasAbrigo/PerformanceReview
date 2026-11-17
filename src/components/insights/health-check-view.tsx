import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { HealthCheckLanding } from "@/modules/insights/health-check";

const QUESTIONS = ["format", "period", "personKey", "scale"] as const;

/** CAP's health check: what was landed, and why nothing more is shown yet. */
export function HealthCheckView({ data }: { data: HealthCheckLanding }) {
  const t = useTranslations("Insights.HealthCheck");
  const format = useFormatter();
  const stats = [
    ["files", data.files],
    ["runs", data.runs],
    ["rows", data.rows],
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      <div role="status" className="rounded-lg border p-4">
        <p className="font-semibold">{t("pending")}</p>
        <p className="text-sm text-muted-foreground">{t("pendingHint")}</p>
        <p className="text-sm text-muted-foreground">{t("versionNote")}</p>
      </div>
      <dl className="flex flex-wrap gap-4">
        {stats.map(([key, value]) => (
          <div key={key} className="rounded-lg border p-4">
            <dt className="text-sm text-muted-foreground">{t(key)}</dt>
            <dd
              className="text-3xl font-semibold tabular-nums"
              data-testid={`health-check-${key}`}
            >
              {value}
            </dd>
          </div>
        ))}
        <div className="rounded-lg border p-4">
          <dt className="text-sm text-muted-foreground">{t("lastLanded")}</dt>
          <dd className="text-lg">
            {data.lastLandedAt
              ? format.dateTime(data.lastLandedAt, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : t("never")}
          </dd>
        </div>
      </dl>
      <Link href="/imports/upload" className="underline">
        {t("upload")}
      </Link>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("questionsTitle")}</h2>
        <ul aria-label={t("questionsTitle")} className="list-disc pl-6 text-sm">
          {QUESTIONS.map((q) => (
            <li key={q}>{t(`questions.${q}`)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
