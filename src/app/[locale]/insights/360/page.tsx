import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Dm360View } from "@/components/dm-360/dm-360-view";
import { parseDm360Params } from "@/components/dm-360/params";
import { db } from "@/db/client";
import { routing } from "@/i18n/routing";
import { getActor } from "@/modules/actor/server";
import { dm360, dm360Scopes } from "@/modules/analytics/dm-360";
import { indicatorCycles } from "@/modules/analytics/indicators";
import { insightsScope } from "@/modules/insights/authz";
import { localizeCycles } from "@/modules/review-core/cycle-name";

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
  // The scope decides what is shown: People every DM, a manager their own
  // card (when they are a DM), direction aggregates; anybody else nothing.
  const scope = insightsScope(actor);
  if (scope.kind === "none") {
    return (
      <section className="flex flex-col gap-2" data-testid="no-access">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p>{t("forbidden")}</p>
      </section>
    );
  }
  const cycles = localizeCycles(await indicatorCycles(db), locale);
  if (!cycles.length) return <p>{t("noCycles")}</p>;
  const p = parseDm360Params(await searchParams);
  const cycle = cycles.find((c) => c.id === p.cycle) ?? cycles[0];
  const data = await dm360(db, actor, { cycleId: cycle.id, scope: p.scope });
  const own = scope.kind === "directReports";
  const hint =
    scope.kind === "aggregatesOnly"
      ? t("hint.aggregates", { min: scope.minGroupSize })
      : own
        ? data.cards.length > 0
          ? t("hint.own")
          : t("hint.notDm")
        : t("hint.all");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">
        {t("heading", { cycle: cycle.name })}
      </h1>
      <p className="text-sm text-muted-foreground">{hint}</p>
      <form
        method="get"
        aria-label={t("filters.label")}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-sm">
          {t("filters.cycle")}
          <select
            name="cycle"
            defaultValue={cycle.id}
            className="rounded-md border bg-background px-2 py-1"
          >
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {own ? null : (
          <label className="flex flex-col gap-1 text-sm">
            {t("filters.scope")}
            <select
              name="scope"
              defaultValue={data.scope}
              className="rounded-md border bg-background px-2 py-1"
            >
              {dm360Scopes.map((s) => (
                <option key={s} value={s}>
                  {t(`scope.${s}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="rounded-md border px-3 py-1 text-sm">
          {t("filters.apply")}
        </button>
      </form>
      {own ? null : (
        <p className="text-sm text-muted-foreground">
          {t(`scopeHint.${data.scope}`)}
        </p>
      )}
      <Dm360View data={data} />
    </div>
  );
}

export default function Insights360Page(
  props: PageProps<"/[locale]/insights/360">,
) {
  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <Suspense fallback={<div aria-busy="true" className="h-40" />}>
        <Insights360 {...props} />
      </Suspense>
    </main>
  );
}
