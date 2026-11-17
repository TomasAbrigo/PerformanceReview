// Each section of the report is one collector. The named report reads as
// People (DEFAULT_ACTOR: everything); the anonymized one as direction with
// the report's minimum group size, so the analytics layer masks what it
// already knows how to (indicators, executive groups), and this layer adds
// the rest: "Otros" / suppressed folds, "Equipo N" labels, no totals next to
// a suppressed group (no reconstruction by difference), re-pseudonymized
// quotes, no people section.
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { type ActorContext, DEFAULT_ACTOR } from "@/modules/actor/types";
import { bins, executiveSummary } from "@/modules/analytics/dashboards";
import {
  indicatorAlerts,
  indicatorDistribution,
  indicators,
  riskMatrix,
} from "@/modules/analytics/indicators";
import { foldGroups } from "@/modules/insights/aggregation";
import { effectiveCte } from "@/modules/qualitative-analysis/effective";
import { pseudonymize } from "@/modules/qualitative-analysis/pseudonymize";
import {
  sentimentByDimension,
  sentimentTrend,
  topThemes,
} from "@/modules/qualitative-analysis/queries";
import { pseudonymSources } from "@/modules/qualitative-analysis/service";
import { sumBy, teamLabels } from "./anonymize";
import type { Labels } from "./labels";
import type {
  ArturiaSections,
  CompletionSection,
  PersonRow,
  QualitativeSection,
} from "./schema";

export type CollectContext = {
  cycleId: string;
  anonymized: boolean;
  /** Smallest group shown: the report's minGroupSize when anonymized, else 1. */
  min: number;
  labels: Labels;
};

export type Collector<K extends keyof ArturiaSections> = (
  db: DbOrTx,
  ctx: CollectContext,
) => Promise<ArturiaSections[K]>;

/** Direction: aggregates only, groups under the minimum folded or hidden. */
export const DIRECTION_ACTOR: ActorContext = {
  personId: null,
  role: "direction",
};

export const actorOf = (ctx: CollectContext): ActorContext =>
  ctx.anonymized ? DIRECTION_ACTOR : DEFAULT_ACTOR;

// ------------------------------------------------------------- executive

export const collectExecutive: Collector<"executive"> = async (db, ctx) => {
  const s = await executiveSummary(db, actorOf(ctx), {
    cycleId: ctx.cycleId,
    minGroupSize: ctx.min,
  });
  const hidden = ctx.anonymized && s.suppressed > 0;
  return {
    participants: s.participants,
    progress: s.progress,
    bins,
    distribution: hidden ? null : s.distribution,
    byDepartment: [
      ...s.byDepartment.map((d) => ({
        label: d.department,
        n: d.n,
        mean: d.mean,
        counts: d.counts,
        other: false,
      })),
      ...(s.others
        ? [{ label: ctx.labels.others, ...s.others, other: true }]
        : []),
    ],
    suppressed: s.suppressed,
  };
};

// ------------------------------------------------------------ completion

type Row = CompletionSection["byDepartment"][number];
type Acc = Row & { ids: Set<string> };

/**
 * Requests per relationship, area and team of the snapshot. A group's n is
 * its distinct participants (a person with three peer reviews counts once).
 * TODO(#59): enrich with completionSummary / missingAssessments.
 */
export const collectCompletion: Collector<"completion"> = async (db, ctx) => {
  const rows = await db.execute<{
    participant_id: string;
    relationship: string;
    department: string | null;
    manager_id: string | null;
    manager_name: string | null;
    total: number;
    submitted: number;
    draft: number;
    declined: number;
  }>(sql`
    select cp.id as participant_id, r.relationship::text as relationship,
           cp.snap_department as department, cp.snap_manager_person_id as manager_id,
           mp.display_name as manager_name, count(*)::int as total,
           count(*) filter (where r.status = 'submitted')::int as submitted,
           count(*) filter (where r.status = 'draft')::int as draft,
           count(*) filter (where r.status = 'declined')::int as declined
    from review_request r
    join cycle_participant cp on cp.id = r.participant_id
    left join person mp on mp.id = cp.snap_manager_person_id
    where r.cycle_id = ${ctx.cycleId}::uuid and r.deleted_at is null and cp.removed_at is null
    group by 1, 2, 3, 4, 5`);
  if (!rows.length) return null;
  const teams = teamLabels(
    rows.flatMap((r) => r.manager_id ?? []),
    ctx.labels.team,
  );

  const breakdown = (
    keyOf: (r: (typeof rows)[number]) => { id: string; label: string } | null,
  ) => {
    const acc = new Map<string, Acc>();
    for (const r of rows) {
      const key = keyOf(r);
      const id = `${r.relationship}\u0000${key?.id ?? ""}`;
      const a = acc.get(id) ?? {
        label: key?.label ?? ctx.labels.others,
        relationship: r.relationship,
        n: 0,
        total: 0,
        submitted: 0,
        other: key === null,
        ids: new Set<string>(),
      };
      a.ids.add(r.participant_id);
      a.n = a.ids.size;
      a.total += r.total;
      a.submitted += r.submitted;
      acc.set(id, a);
    }
    const groups = [...acc.values()].sort(
      (a, b) =>
        a.relationship.localeCompare(b.relationship) ||
        a.label.localeCompare(b.label, "es"),
    );
    const out: Row[] = [];
    let suppressed = 0;
    for (const rel of [...new Set(groups.map((g) => g.relationship))]) {
      const f = foldGroups(
        groups.filter((g) => g.relationship === rel),
        ctx.min,
        {
          size: (g) => g.n,
          named: (g) => !g.other,
          merge: (rest) => {
            const ids = new Set(rest.flatMap((g) => [...g.ids]));
            return {
              label: ctx.labels.others,
              relationship: rel,
              n: ids.size,
              total: sumBy(rest, (g) => g.total),
              submitted: sumBy(rest, (g) => g.submitted),
              other: true,
              ids,
            };
          },
        },
      );
      for (const { ids: _ids, ...g } of [
        ...f.shown,
        ...(f.others ? [f.others] : []),
      ]) {
        void _ids;
        out.push(g);
      }
      suppressed = Math.max(suppressed, f.suppressed);
    }
    return { rows: out, suppressed };
  };

  const dep = breakdown((r) =>
    r.department === null ? null : { id: r.department, label: r.department },
  );
  const man = breakdown((r) =>
    r.manager_id === null
      ? null
      : {
          id: r.manager_id,
          label: ctx.anonymized
            ? teams.get(r.manager_id)!
            : (r.manager_name ?? teams.get(r.manager_id)!),
        },
  );
  const totals = new Map<
    string,
    NonNullable<CompletionSection["byRelationship"]>[number]
  >();
  for (const r of rows) {
    const t = totals.get(r.relationship) ?? {
      relationship: r.relationship,
      total: 0,
      submitted: 0,
      draft: 0,
      declined: 0,
    };
    t.total += r.total;
    t.submitted += r.submitted;
    t.draft += r.draft;
    t.declined += r.declined;
    totals.set(r.relationship, t);
  }
  const hidden = ctx.anonymized && (dep.suppressed > 0 || man.suppressed > 0);
  return {
    byRelationship: hidden
      ? null
      : [...totals.values()].sort((a, b) =>
          a.relationship.localeCompare(b.relationship),
        ),
    byDepartment: dep.rows,
    byManager: man.rows,
    suppressed: { byDepartment: dep.suppressed, byManager: man.suppressed },
  };
};

// ------------------------------------------------------------ indicators

/**
 * Retention and engagement (#60) per area, the risk matrix and the alert
 * counts (never named). Anonymized, the indicators module masks as for
 * direction: small areas folded into "others" or hidden, totals and matrix
 * cells null when something is suppressed.
 */
export const collectIndicators: Collector<"indicators"> = async (db, ctx) => {
  const actor = actorOf(ctx);
  const config = { minGroupSize: ctx.min };
  const [dists, matrix, alerts] = await Promise.all([
    Promise.all(
      indicators.map((indicator) =>
        indicatorDistribution(db, actor, {
          cycleId: ctx.cycleId,
          indicator,
          groupBy: "department",
          config,
        }),
      ),
    ),
    riskMatrix(db, actor, { cycleId: ctx.cycleId, config }),
    indicatorAlerts(db, actor, { cycleId: ctx.cycleId, config }),
  ]);
  if (dists.every((d) => d.series.length === 0 && d.suppressed === 0)) {
    return null;
  }
  return {
    distribution: dists.map((d) => ({
      indicator: d.indicator,
      groups: d.series.map((s) => ({
        label:
          s.others || s.key === null ? ctx.labels.others : (s.label ?? s.key),
        n: s.n,
        mean: s.mean,
        counts: s.counts,
        other: s.others || s.key === null,
      })),
      total: d.total
        ? { n: d.total.n, mean: d.total.mean, counts: d.total.counts }
        : null,
      suppressed: d.suppressed,
    })),
    riskMatrix: {
      cells: matrix.cells.map((c) => ({
        retention: c.retention,
        engagement: c.engagement,
        count: c.count,
        risk: c.risk,
      })),
      total: matrix.total,
      riskCount: matrix.riskCount,
    },
    alerts: [
      { kind: "drop", indicator: null, count: alerts.peopleWithDrop },
      { kind: "risk", indicator: null, count: alerts.peopleAtRisk },
    ].flatMap((a) =>
      a.count === null || a.count < ctx.min ? [] : [{ ...a, count: a.count }],
    ),
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

const withoutN = <T extends { n: number }>(x: T): Omit<T, "n"> => {
  const rest: Partial<T> = { ...x };
  delete rest.n;
  return rest as Omit<T, "n">;
};

/**
 * Sentiment per dimension, trend over cycles and top themes, computed as
 * People and folded here by distinct participants. `suppressed` counts
 * people (the dimensions, themes and trend points left out; a person in
 * several of them counts in each, so it is an upper bound).
 */
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
  const others = ctx.labels.others;

  type Dim = QualitativeSection["sentimentByDimension"][number] & { n: number };
  const d = foldGroups<Dim>(
    dims.map((x) => ({
      ...x,
      other: false,
      n: sizes.dimension.get(x.dimension) ?? 0,
    })),
    ctx.min,
    {
      size: (x) => x.n,
      // overlapping groups: the largest is a safe lower bound of the union
      merge: (rest) => ({
        dimension: others,
        other: true,
        n: Math.max(...rest.map((x) => x.n)),
        positive: sumBy(rest, (x) => x.positive),
        constructive: sumBy(rest, (x) => x.constructive),
        negative: sumBy(rest, (x) => x.negative),
        total: sumBy(rest, (x) => x.total),
      }),
    },
  );
  const cycleSize = (id: string) => sizes.cycle.get(id) ?? 0;
  const keptTrend = trend.filter((t) => cycleSize(t.cycleId) >= ctx.min);

  type Theme = QualitativeSection["topThemes"][number] & { n: number };
  const t = foldGroups<Theme>(
    themes.map((x) => ({
      ...x,
      other: false,
      n: sizes.theme.get(x.theme) ?? 0,
    })),
    ctx.min,
    {
      size: (x) => x.n,
      merge: (rest) => ({
        theme: others,
        count: sumBy(rest, (x) => x.count),
        other: true,
        n: Math.max(...rest.map((x) => x.n)),
        quotes: [],
      }),
    },
  );
  // Quotes come pseudonymized from the qualitative module; run them (and the
  // theme names) through the pseudonymizer again, belt and braces.
  return {
    sentimentByDimension: [...d.shown, ...(d.others ? [d.others] : [])].map(
      withoutN,
    ),
    trend: keptTrend,
    topThemes: [...t.shown, ...(t.others ? [t.others] : [])].map((x) => ({
      ...withoutN(x),
      theme: x.other ? x.theme : pseudonymize([x.theme], sources).texts[0],
      quotes: [...new Set(pseudonymize(x.quotes, sources).texts)],
    })),
    suppressed:
      d.suppressed +
      t.suppressed +
      sumBy(
        trend.filter((x) => !keptTrend.includes(x)),
        (x) => cycleSize(x.cycleId),
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
