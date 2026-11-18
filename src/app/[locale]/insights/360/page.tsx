import { EmptyState } from "@/components/experience";
import { PageSkeleton } from "@/components/experience";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { groupKicker } from "@/components/page-kicker";
import { Dm360View } from "@/components/dm-360/dm-360-view";
import { parseDm360Params } from "@/components/dm-360/params";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { dm360, dm360Scopes } from "@/modules/analytics/dm-360";
import { indicatorCycles } from "@/modules/analytics/indicators";
import { insightsScope } from "@/modules/insights/authz";
import { localizeCycles } from "@/modules/review-core/cycle-name";
import type { DrillBase } from "@/components/drill/drill-link";
import { parseDrill } from "@/modules/insights/drill-spec";
import { kpiThresholds } from "@/modules/insights/tone";
import { getSettings } from "@/modules/settings";
import { DrillSection } from "../drill-section";

async function Insights360({
  params,
  searchParams,
}: PageProps<"/[locale]/insights/360">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await connection();
  const actor = await getActor();
  const t = await getTranslations("Insights360");
  const kicker = await groupKicker("insights");
  // The scope decides what is shown: People every DM, a manager their own
  // card (when they are a DM), direction aggregates; anybody else nothing.
  const scope = insightsScope(actor);
  if (scope.kind === "none") {
    return (
      <section className="flex flex-col gap-2" data-testid="no-access">
        <h1>{t("title")}</h1>
        <p>{t("forbidden")}</p>
      </section>
    );
  }
  const cycles = localizeCycles(await indicatorCycles(db), locale);
  if (!cycles.length) return <EmptyState>{t("noCycles")}</EmptyState>;
  const sp = await searchParams;
  const p = parseDm360Params(sp);
  const settings = await getSettings(db);
  const cycle = cycles.find((c) => c.id === p.cycle) ?? cycles[0];
  const data = await dm360(db, actor, { cycleId: cycle.id, scope: p.scope });
  const own = scope.kind === "directReports";
  // Drill-down (drill-section.tsx): the figures of a card open its people or
  // comments; only with names (not direction) and in the direct scope, the
  // one the drills read.
  const base: DrillBase = { pathname: "/insights/360", query: sp };
  const canDrill = scope.kind !== "aggregatesOnly" && data.scope === "direct";
  const parsed = canDrill ? parseDrill(sp.drill) : null;
  const drill =
    parsed?.kind === "dm" || parsed?.kind === "comments" ? parsed : null;
  const hint =
    scope.kind === "aggregatesOnly"
      ? t("hint.aggregates", { min: scope.minGroupSize })
      : own
        ? data.cards.length > 0
          ? t("hint.own")
          : t("hint.notDm")
        : t("hint.all");
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={kicker}
        title={t("heading", { cycle: cycle.name })}
        description={hint}
      >
        <form
          method="get"
          aria-label={t("filters.label")}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="control-label">
            {t("filters.cycle")}
            <select name="cycle" defaultValue={cycle.id} className="control">
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {own ? null : (
            <label className="control-label">
              {t("filters.scope")}
              <select
                name="scope"
                defaultValue={data.scope}
                className="control"
              >
                {dm360Scopes.map((s) => (
                  <option key={s} value={s}>
                    {t(`scope.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="button-outline">
            {t("filters.apply")}
          </button>
        </form>
        {own ? null : (
          <p className="text-sm text-muted-foreground">
            {t(`scopeHint.${data.scope}`)}
          </p>
        )}
      </PageHeader>
      <Dm360View
        data={data}
        base={canDrill ? base : undefined}
        thresholds={kpiThresholds(settings)}
      />
      {drill ? (
        <Suspense fallback={null}>
          <DrillSection
            actor={actor}
            cycleId={cycle.id}
            drill={drill}
            base={base}
            minGroupSize={settings["aggregation.minGroupSize"]}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export default function Insights360Page(
  props: PageProps<"/[locale]/insights/360">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-6 lg:p-10">
      <Suspense fallback={<PageSkeleton />}>
        <Insights360 {...props} />
      </Suspense>
    </main>
  );
}
