// The drill-down of an insights page, rendered by the page when the URL has
// `?drill=…` (see modules/insights/drill-spec.ts). How a page wires one:
//
//   const base: DrillBase = { pathname: "/insights/x", query: sp };
//   const drill = parseDrill(sp.drill);
//   ... charts get `base` and turn marks into <DrillLink base drill label> ...
//   {drill ? (
//     <Suspense fallback={null}>
//       <DrillSection actor={actor} cycleId={id} drill={drill} base={base}
//         minGroupSize={min} filters={filters} />
//     </Suspense>
//   ) : null}
//
// The records come from `drillRecords` (authz.ts scope, minimum group size,
// direction never gets names); the sheet closes back to `base` without it.
import { getTranslations } from "next-intl/server";
import { type DrillBase, drillHref } from "@/components/drill/drill-link";
import { DrillSheet } from "@/components/drill/drill-sheet";
import { DrillView } from "@/components/drill/drill-view";
import { humanizeTheme } from "@/components/qualitative/theme-label";
import { db } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { drillRecords } from "@/modules/insights/drill";
import { type Drill, formatDrill } from "@/modules/insights/drill-spec";
import type { OrgFilters } from "@/modules/org-attributes/kinds";
import { dimensionLabels } from "./dimension-labels";

/** The sheet's title: what the mark was, in words. */
async function drillTitle(drill: Drill): Promise<string> {
  const t = await getTranslations("Drill.title");
  const ti = await getTranslations("Indicators");
  const ts = await getTranslations("Qualitative.sentiment");
  const tt = await getTranslations("Themes");
  switch (drill.kind) {
    case "indicator":
      return drill.value === null
        ? t("indicatorAll", { indicator: ti(`indicator.${drill.indicator}`) })
        : t("indicator", {
            indicator: ti(`indicator.${drill.indicator}`),
            value: drill.value,
          });
    case "risk":
      return t("risk", {
        quadrant: ti(`matrix.quadrant.${drill.retention}.${drill.engagement}`),
      });
    case "theme":
      return t("theme", {
        theme: tt.has(drill.theme as "proyecto")
          ? tt(drill.theme as "proyecto")
          : humanizeTheme(drill.theme),
      });
    case "sentiment": {
      const labels = await dimensionLabels([drill.dimension]);
      return t("sentiment", {
        dimension: labels[drill.dimension] ?? drill.dimension,
        sentiment: ts(drill.sentiment),
      });
    }
    case "completion":
      return t(`completion.${drill.side}.${drill.state}`);
    case "goals":
      return t(`goals.${drill.state}`);
  }
}

export async function DrillSection({
  actor,
  cycleId,
  drill,
  base,
  minGroupSize,
  filters,
}: {
  actor: ActorContext;
  cycleId: string;
  drill: Drill;
  base: DrillBase;
  minGroupSize: number;
  filters?: OrgFilters;
}) {
  const [result, title] = await Promise.all([
    drillRecords(db, actor, { cycleId, drill, minGroupSize, filters }),
    drillTitle(drill),
  ]);
  return (
    <DrillSheet
      key={formatDrill(drill)}
      title={title}
      closeHref={drillHref(base, null)}
    >
      <DrillView result={result} />
    </DrillSheet>
  );
}
