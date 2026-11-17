import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Panel } from "@/components/dashboards/parts";
import { TrendChart } from "@/components/indicators/trend-chart";
import { TrendPicker } from "@/components/indicators/trend-picker";
import { parseTrendParams } from "@/components/indicators/url-state";
import { db } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import {
  indicators,
  indicatorScope,
  indicatorSubjects,
  indicatorTrend,
  type IndicatorTrend,
} from "@/modules/analytics/indicators";
import { ReviewError } from "@/modules/review-core";

async function Trend({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/indicators/trend">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Indicators");
  if (indicatorScope(actor) === "none") return <p>{t("forbidden")}</p>;
  const p = parseTrendParams(await searchParams);
  // One subject: a person, else a team, else an area, else the actor's reach.
  const subject = p.person
    ? { personId: p.person }
    : p.manager
      ? { managerId: p.manager }
      : p.department
        ? { department: p.department }
        : {};
  const [subjects, ...trends] = await Promise.all([
    indicatorSubjects(db, actor),
    ...indicators.map((indicator) =>
      indicatorTrend(db, actor, { indicator, ...subject }).catch(
        forbiddenAsNull,
      ),
    ),
  ]);
  if (trends.some((trend) => trend === null)) return <p>{t("forbidden")}</p>;
  const found = trends as IndicatorTrend[];
  const about = found[0].subject;
  const subjectLabel =
    about.kind === "person"
      ? t("trend.subject.person", { name: about.name })
      : about.kind === "manager"
        ? t("trend.subject.team", { name: about.name })
        : about.kind === "department"
          ? t("trend.subject.department", { name: about.department })
          : actor.role === "manager"
            ? t("trend.subject.myTeam")
            : t("trend.subject.all");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("trend.title")}</h1>
        <Link className="text-sm underline" href="/insights/indicators">
          {t("trend.back")}
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("trend.hint", {
          scope:
            actor.role === "manager"
              ? t("trend.subject.myTeam")
              : t("trend.subject.all"),
        })}
      </p>
      <TrendPicker params={p} subjects={subjects} />
      {found.map((trend) => (
        <Panel
          key={trend.indicator}
          id={`trend-${trend.indicator}`}
          title={t("trend.of", {
            indicator: t(`indicator.${trend.indicator}`),
            subject: subjectLabel,
          })}
        >
          <TrendChart data={trend} subject={subjectLabel} />
        </Panel>
      ))}
    </div>
  );
}

/** forbidden -> null (shown as a message), not_found -> 404. */
function forbiddenAsNull(error: unknown): null {
  if (!(error instanceof ReviewError)) throw error;
  if (error.code === "not_found") notFound();
  return null;
}

export default function TrendPage(
  props: PageProps<"/[locale]/insights/indicators/trend">,
) {
  return (
    <main className="mx-auto w-full max-w-5xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Trend {...props} />
      </Suspense>
    </main>
  );
}
