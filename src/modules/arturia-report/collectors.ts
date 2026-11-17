// Each section of the report is one collector: it reads as People
// (DEFAULT_ACTOR: everything, unmasked) and applies the anonymization of the
// export itself, so the report never depends on a role's masking rules.
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { DEFAULT_ACTOR } from "@/modules/actor/types";
import {
  bins,
  cycleProgress,
  executiveSummary,
  type DashboardFilters,
} from "@/modules/analytics/dashboards";
import {
  indicatorAlerts,
  indicatorDistribution,
  indicators,
  riskMatrix,
} from "@/modules/analytics/indicators";
import { foldSmallGroups } from "@/modules/insights/aggregation";
import { effectiveCte } from "@/modules/qualitative-analysis/effective";
import { pseudonymize } from "@/modules/qualitative-analysis/pseudonymize";
import {
  sentimentByDimension,
  sentimentTrend,
  topThemes,
} from "@/modules/qualitative-analysis/queries";
import { pseudonymSources } from "@/modules/qualitative-analysis/service";
import { foldGroups, OTHERS, sumBy, teamLabels } from "./anonymize";
import type {
  ArturiaSections,
  CompletionSection,
  ExecutiveSection,
  PersonRow,
  QualitativeSection,
} from "./schema";

export type CollectContext = {
  cycleId: string;
  anonymized: boolean;
  /** Smallest group shown: the report's minGroupSize when anonymized, else 1. */
  min: number;
};

export type Collector<K extends keyof ArturiaSections> = (
  db: DbOrTx,
  ctx: CollectContext,
) => Promise<ArturiaSections[K]>;

// ------------------------------------------------------------- executive

export const collectExecutive: Collector<"executive"> = async (db, ctx) => {
  // People's view: every department unmasked, people without one in "Otros".
  const s = await executiveSummary(db, DEFAULT_ACTOR, { cycleId: ctx.cycleId });
  const empty = bins.map(() => 0);
  const base: ExecutiveSection = {
    participants: s.participants,
    progress: s.progress,
    bins,
    distribution: s.distribution,
    byDepartment: [],
    suppressed: 0,
  };
  const rated = sumBy(s.distribution, (c) => c);
  if (s.participants < ctx.min) {
    return { ...base, progress: [], distribution: empty, suppressed: rated };
  }
  const groups = [
    ...s.byDepartment.map((d) => ({
      key: d.department as string | null,
      n: d.n,
      mean: d.mean,
      counts: d.counts,
    })),
    ...(s.others ? [{ key: null, ...s.others }] : []),
  ];
  const { shown, others, suppressed } = foldSmallGroups(groups, ctx.min);
  return {
    ...base,
    distribution: rated < ctx.min ? empty : s.distribution,
    byDepartment: [
      ...shown.map((g) => ({
        label: g.key ?? OTHERS,
        n: g.n,
        mean: g.mean,
        counts: g.counts,
        other: false,
      })),
      ...(others ? [{ label: OTHERS, ...others, other: true }] : []),
    ],
    suppressed: suppressed + s.suppressed,
  };
};

// ------------------------------------------------------------ completion

type Row = CompletionSection["byDepartment"][number];

function foldCompletion(
  rows: Row[],
  min: number,
): { rows: Row[]; suppressed: number } {
  const out: Row[] = [];
  let suppressed = 0;
  for (const rel of [...new Set(rows.map((r) => r.relationship))]) {
    const f = foldGroups(
      rows.filter((r) => r.relationship === rel),
      min,
      (r) => r.n,
      (rest) => ({
        label: OTHERS,
        relationship: rel,
        n: sumBy(rest, (r) => r.n),
        total: sumBy(rest, (r) => r.total),
        submitted: sumBy(rest, (r) => r.submitted),
        other: true,
      }),
      (r) => !r.other,
    );
    out.push(...f.shown, ...(f.others ? [f.others] : []));
    suppressed += f.suppressed;
  }
  return { rows: out, suppressed };
}

/**
 * Requests per relationship, area and team (the snapshot's), from the cycle
 * progress dashboard. A group's n is its number of requests of that
 * relationship. TODO(#59): enrich with completionSummary / missingAssessments
 * once `src/modules/analytics/completion` lands.
 */
export const collectCompletion: Collector<"completion"> = async (db, ctx) => {
  const filters: DashboardFilters = {
    cycleId: ctx.cycleId,
    hierarchy: "asOf",
  };
  const p = await cycleProgress(db, DEFAULT_ACTOR, filters);
  const teams = teamLabels(p.rows.flatMap((r) => r.managerId ?? []));
  const by = (keyOf: (r: (typeof p.rows)[number]) => string | null) => {
    const acc = new Map<string, Row>();
    for (const r of p.rows) {
      const key = keyOf(r);
      const id = `${r.relationship}\u0000${key ?? ""}`;
      const row = acc.get(id) ?? {
        label: key ?? OTHERS,
        relationship: r.relationship,
        n: 0,
        total: 0,
        submitted: 0,
        other: key === null,
      };
      row.n += r.total;
      row.total += r.total;
      row.submitted += r.submitted;
      acc.set(id, row);
    }
    return [...acc.values()].sort(
      (a, b) =>
        a.relationship.localeCompare(b.relationship) ||
        a.label.localeCompare(b.label, "es"),
    );
  };
  const dep = foldCompletion(
    by((r) => r.department),
    ctx.min,
  );
  const man = foldCompletion(
    by((r) =>
      r.managerId === null
        ? null
        : ctx.anonymized
          ? teams.get(r.managerId)!
          : (r.managerName ?? teams.get(r.managerId)!),
    ),
    ctx.min,
  );
  return {
    byRelationship: p.totals.map((t) => ({
      relationship: t.relationship,
      total: t.total,
      submitted: t.submitted,
      draft: t.draft,
      declined: t.declined,
    })),
    byDepartment: dep.rows,
    byManager: man.rows,
    suppressed: Math.max(dep.suppressed, man.suppressed),
  };
};

// ------------------------------------------------- indicators and goals

/**
 * Retention and engagement (#60) per area, the risk matrix and the alerts,
 * counted (never named). Anonymized: areas under the minimum fold into
 * "Otros", matrix cells and alert counts under it are hidden (null / left out).
 */
export const collectIndicators: Collector<"indicators"> = async (db, ctx) => {
  const [dists, matrix, alerts] = await Promise.all([
    Promise.all(
      indicators.map((indicator) =>
        indicatorDistribution(db, DEFAULT_ACTOR, {
          cycleId: ctx.cycleId,
          indicator,
          groupBy: "department",
        }),
      ),
    ),
    riskMatrix(db, DEFAULT_ACTOR, { cycleId: ctx.cycleId }),
    indicatorAlerts(db, DEFAULT_ACTOR, { cycleId: ctx.cycleId }),
  ]);
  if (dists.every((d) => d.series.every((s) => s.n === 0))) return null;
  const visible = (n: number | null) => (n !== null && n >= ctx.min ? n : null);
  const alertCounts = new Map<
    string,
    { kind: string; indicator: string | null; count: number }
  >();
  for (const a of alerts.alerts) {
    const indicator = a.kind === "drop" ? a.indicator : null;
    const key = `${a.kind}:${indicator ?? ""}`;
    const row = alertCounts.get(key) ?? { kind: a.kind, indicator, count: 0 };
    row.count += 1;
    alertCounts.set(key, row);
  }
  return {
    distribution: dists.map((d) => {
      const { shown, others, suppressed } = foldSmallGroups(
        d.series.map((s) => ({
          key: s.others ? null : s.key === null ? null : (s.label ?? s.key),
          n: s.n,
          mean: s.mean,
          counts: s.counts,
        })),
        ctx.min,
      );
      return {
        indicator: d.indicator,
        groups: [
          ...shown.map((g) => ({
            label: g.key ?? OTHERS,
            n: g.n,
            mean: g.mean,
            counts: g.counts,
            other: false,
          })),
          ...(others ? [{ label: OTHERS, ...others, other: true }] : []),
        ],
        total:
          d.total && d.total.n >= ctx.min
            ? { n: d.total.n, mean: d.total.mean, counts: d.total.counts }
            : null,
        suppressed: suppressed + d.suppressed,
      };
    }),
    riskMatrix: {
      cells: matrix.cells.map((c) => ({
        retention: c.retention,
        engagement: c.engagement,
        count: visible(c.count),
        risk: c.risk,
      })),
      total: visible(matrix.total),
      riskCount: visible(matrix.riskCount),
    },
    alerts: [...alertCounts.values()].filter((a) => a.count >= ctx.min),
  };
};

/** TODO(#62): wire the goals insights once they land. */
export const collectGoals: Collector<"goals"> = async () => null;

// ----------------------------------------------------------- qualitative

/** Distinct participants per dimension, theme and cycle (the group sizes). */
async function qualitativeSizes(db: DbOrTx, cycleId: string) {
  const rows = await db.execute<{ kind: string; key: string; n: number }>(sql`
    with ${effectiveCte()},
    l as (
      select eff.dimension, eff.themes, r.cycle_id, r.participant_id
      from eff
      join answer a on a.id = eff.answer_id
      join review_request r on r.id = a.request_id
      join cycle_participant cp on cp.id = r.participant_id
      where r.deleted_at is null and r.status = 'submitted' and cp.removed_at is null
    )
    select 'dimension' as kind, dimension as key, count(distinct participant_id)::int as n
      from l where cycle_id = ${cycleId}::uuid group by dimension
    union all
    select 'theme', t, count(distinct participant_id)::int
      from l, unnest(themes) t where cycle_id = ${cycleId}::uuid group by t
    union all
    select 'cycle', cycle_id::text, count(distinct participant_id)::int
      from l group by cycle_id`);
  const of = (kind: string) =>
    new Map(rows.filter((r) => r.kind === kind).map((r) => [r.key, r.n]));
  return { dimension: of("dimension"), theme: of("theme"), cycle: of("cycle") };
}

export const collectQualitative: Collector<"qualitative"> = async (db, ctx) => {
  const f = { cycleId: ctx.cycleId };
  const [dims, trend, themes, sizes, sources] = await Promise.all([
    sentimentByDimension(db, DEFAULT_ACTOR, f),
    sentimentTrend(db, DEFAULT_ACTOR, {}),
    topThemes(db, DEFAULT_ACTOR, f),
    qualitativeSizes(db, ctx.cycleId),
    pseudonymSources(db),
  ]);
  if (!dims.length && !trend.length) return null;

  type Dim = QualitativeSection["sentimentByDimension"][number] & { n: number };
  const d = foldGroups<Dim>(
    dims.map((x) => ({
      ...x,
      other: false,
      n: sizes.dimension.get(x.dimension) ?? 0,
    })),
    ctx.min,
    (x) => x.n,
    (rest) => ({
      dimension: OTHERS,
      other: true,
      n: Math.max(...rest.map((x) => x.n)),
      positive: sumBy(rest, (x) => x.positive),
      constructive: sumBy(rest, (x) => x.constructive),
      negative: sumBy(rest, (x) => x.negative),
      total: sumBy(rest, (x) => x.total),
    }),
  );
  const keptTrend = trend.filter(
    (t) => (sizes.cycle.get(t.cycleId) ?? 0) >= ctx.min,
  );

  type Theme = QualitativeSection["topThemes"][number] & { n: number };
  const t = foldGroups<Theme>(
    themes.map((x) => ({
      ...x,
      other: false,
      n: sizes.theme.get(x.theme) ?? 0,
    })),
    ctx.min,
    (x) => x.n,
    (rest) => ({
      theme: OTHERS,
      count: sumBy(rest, (x) => x.count),
      other: true,
      n: Math.max(...rest.map((x) => x.n)),
      quotes: [],
    }),
  );
  // Quotes come pseudonymized from the qualitative module; run them (and the
  // theme names) through the pseudonymizer again, belt and braces.
  const shownThemes = [...t.shown, ...(t.others ? [t.others] : [])];
  const strip = <T extends { n: number }>(x: T): Omit<T, "n"> => {
    const rest: Partial<T> = { ...x };
    delete rest.n;
    return rest as Omit<T, "n">;
  };
  return {
    sentimentByDimension: [...d.shown, ...(d.others ? [d.others] : [])].map(
      strip,
    ),
    trend: keptTrend,
    topThemes: shownThemes.map((x) => ({
      ...strip(x),
      theme: x.other ? x.theme : pseudonymize([x.theme], sources).texts[0],
      quotes: [...new Set(pseudonymize(x.quotes, sources).texts)],
    })),
    suppressed:
      d.suppressed +
      sumBy(
        trend.filter((x) => !keptTrend.includes(x)),
        (x) => x.total,
      ),
  };
};

// ---------------------------------------------------------------- people

/** Per-person rows: only the named report (null when anonymized). */
export const collectPeople: Collector<"people"> = async (db, ctx) => {
  if (ctx.anonymized) return null;
  const rows = await db.execute<{
    person_id: string;
    display_name: string;
    email: string | null;
    department: string | null;
    manager: string | null;
    self_status: string | null;
    manager_status: string | null;
    retention: string | null;
    engagement: string | null;
    positive: number;
    comments: number;
  }>(sql`
    with ${effectiveCte()},
    req as (
      select distinct on (participant_id, relationship) participant_id, relationship, status::text as status
      from review_request where cycle_id = ${ctx.cycleId}::uuid and deleted_at is null
      order by participant_id, relationship, requested_at desc, id
    ),
    ind as (
      select distinct on (r.participant_id, q.role) r.participant_id, q.role::text as role,
             coalesce((select c->'label'->>'es' from jsonb_array_elements(q.choices) c
                       where c->>'value' = a.option_label limit 1), a.option_label) as label
      from answer a
      join review_request r on r.id = a.request_id
      join question_revision q on q.id = a.question_revision_id
      where r.cycle_id = ${ctx.cycleId}::uuid and q.role::text in ('retention', 'engagement')
        and a.option_label is not null and r.relationship = 'manager'
        and r.status = 'submitted' and r.deleted_at is null
      order by r.participant_id, q.role, r.submitted_at desc nulls last, r.id
    ),
    sen as (
      select r.participant_id,
             count(*) filter (where eff.sentiment = 'positive')::int as positive,
             count(*)::int as comments
      from eff
      join answer a on a.id = eff.answer_id
      join review_request r on r.id = a.request_id
      where r.cycle_id = ${ctx.cycleId}::uuid and r.status = 'submitted' and r.deleted_at is null
      group by r.participant_id
    )
    select p.id as person_id, p.display_name, p.work_email as email,
           cp.snap_department as department, mp.display_name as manager,
           (select status from req where req.participant_id = cp.id and relationship = 'self') as self_status,
           (select status from req where req.participant_id = cp.id and relationship = 'manager') as manager_status,
           (select label from ind where ind.participant_id = cp.id and role = 'retention') as retention,
           (select label from ind where ind.participant_id = cp.id and role = 'engagement') as engagement,
           coalesce(sen.positive, 0) as positive, coalesce(sen.comments, 0) as comments
    from cycle_participant cp
    join person p on p.id = cp.reviewee_person_id
    left join person mp on mp.id = cp.snap_manager_person_id
    left join sen on sen.participant_id = cp.id
    where cp.cycle_id = ${ctx.cycleId}::uuid and cp.removed_at is null
    order by p.display_name, p.id`);
  return rows.map((r): PersonRow => ({
    personId: r.person_id,
    displayName: r.display_name,
    email: r.email,
    department: r.department,
    manager: r.manager,
    selfStatus: r.self_status,
    managerStatus: r.manager_status,
    retention: r.retention,
    engagement: r.engagement,
    positiveShare: r.comments ? r.positive / r.comments : null,
    comments: r.comments,
  }));
};
