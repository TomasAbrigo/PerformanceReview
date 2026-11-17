// Each section of the report is one collector. The named report reads as
// People (DEFAULT_ACTOR: everything); the anonymized one as direction with
// the report's minimum group size, so the analytics layer masks what it
// already knows how to (indicators, executive groups, completion by area,
// goals), and this layer adds the rest: "Otros" / suppressed folds, "Equipo N"
// labels (a manager is a person: direction never gets one from the analytics
// layer, so the completion by team is folded here), no totals next to a
// suppressed group (no reconstruction by difference), re-pseudonymized
// quotes, no people section.
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { type ActorContext, DEFAULT_ACTOR } from "@/modules/actor/types";
import {
  type CompletionCounts,
  type CompletionGroup,
  type CompletionSummary,
  completionOverview,
  completionSummary,
  withRates,
} from "@/modules/analytics/completion";
import { bins, executiveSummary } from "@/modules/analytics/dashboards";
import {
  type GoalKpiGroup,
  type GoalKpis,
  goalInsights,
  goalKpis,
} from "@/modules/analytics/goals-insights";
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
  GoalsSection,
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

/** The "Equipo N" labels of a cycle's managers, the same in every section. */
async function cycleTeams(db: DbOrTx, ctx: CollectContext) {
  const rows = await db.execute<{ id: string }>(sql`
    select distinct snap_manager_person_id as id from cycle_participant
    where cycle_id = ${ctx.cycleId}::uuid and removed_at is null
      and snap_manager_person_id is not null`);
  return teamLabels(
    rows.map((r) => r.id),
    ctx.labels.team,
  );
}

const round = (x: number | null, digits: number) =>
  x === null ? null : Number(x.toFixed(digits));

type CompletionRows = CompletionSection["byDepartment"];
type CompletionCell = CompletionCounts & { label: string; other: boolean };

/** A row per side of the assessment that applies to the group (self first). */
function completionRows(cells: readonly CompletionCell[]): CompletionRows {
  return (["self", "manager"] as const).flatMap((relationship) =>
    cells.flatMap((c) => {
      const total =
        relationship === "self" ? c.selfApplicable : c.managerApplicable;
      return total === 0
        ? []
        : [
            {
              label: c.label,
              relationship,
              n: c.participants,
              total,
              submitted:
                relationship === "self" ? c.selfSubmitted : c.managerSubmitted,
              other: c.other,
            },
          ];
    }),
  );
}

const counts = (g: CompletionGroup): CompletionCounts => ({
  participants: g.participants,
  selfSubmitted: g.selfSubmitted,
  selfApplicable: g.selfApplicable,
  managerSubmitted: g.managerSubmitted,
  managerApplicable: g.managerApplicable,
});

/** The areas of the summary (direction already folded them), as cells. */
const departmentCells = (
  s: CompletionSummary,
  ctx: CollectContext,
): CompletionCell[] => [
  ...s.groups.map((g) => ({
    ...counts(g),
    label: g.label ?? ctx.labels.others,
    other: g.key === null,
  })),
  ...(s.others
    ? [{ ...counts(s.others), label: ctx.labels.others, other: true }]
    : []),
];

/**
 * The teams of the cycle snapshot. The analytics layer never gives direction
 * a manager (a manager is a person), so they are read as People and folded
 * here: managers with fewer than the minimum participants (and the people
 * with no manager) go to "Otros", hidden when that is still under it, and
 * anonymized the managers are "Equipo N", never a name.
 */
async function teamCells(db: DbOrTx, ctx: CollectContext) {
  const [summary, teams] = await Promise.all([
    completionSummary(db, DEFAULT_ACTOR, {
      cycleId: ctx.cycleId,
      groupBy: "manager",
    }),
    cycleTeams(db, ctx),
  ]);
  const sum = (rest: CompletionGroup[]): CompletionCounts => ({
    participants: sumBy(rest, (g) => g.participants),
    selfSubmitted: sumBy(rest, (g) => g.selfSubmitted),
    selfApplicable: sumBy(rest, (g) => g.selfApplicable),
    managerSubmitted: sumBy(rest, (g) => g.managerSubmitted),
    managerApplicable: sumBy(rest, (g) => g.managerApplicable),
  });
  const folded = foldGroups<CompletionGroup>(summary.groups, ctx.min, {
    size: (g) => g.participants,
    named: (g) => g.key !== null,
    merge: (rest) => withRates(null, null, sum(rest)),
  });
  const label = (g: CompletionGroup) =>
    ctx.anonymized
      ? teams.get(g.key!)!
      : (g.label ?? teams.get(g.key!) ?? ctx.labels.others);
  return {
    cells: [
      ...folded.shown.map((g) => ({
        ...counts(g),
        label: label(g),
        other: false,
      })),
      ...(folded.others
        ? [
            {
              ...counts(folded.others),
              label: ctx.labels.others,
              other: true,
            },
          ]
        : []),
    ],
    suppressed: folded.suppressed,
  };
}

/**
 * Completion of the cycle (#59): how many participants submitted their self
 * and their manager assessment, from the completion module (Assessment
 * Progress first, then the review requests), total, by area and by team, and
 * the change against the semester before. Peer and upward reviews are in
 * the executive progress. A group's n is its participants.
 *
 * Anonymized, the module runs as direction with the report's minimum: areas
 * under it are folded into "Otros" or hidden, and the totals (and the change
 * of the total) are null whenever any breakdown has a suppressed group.
 */
export const collectCompletion: Collector<"completion"> = async (db, ctx) => {
  const [{ delta }, teams] = await Promise.all([
    completionOverview(db, actorOf(ctx), {
      cycleId: ctx.cycleId,
      groupBy: "department",
      ...(ctx.anonymized ? { minGroupSize: ctx.min } : {}),
    }),
    teamCells(db, ctx),
  ]);
  const current = delta.current;
  if (current.participants === 0) return null;
  const suppressed = {
    byDepartment: current.suppressed,
    byManager: teams.suppressed,
  };
  const hidden =
    ctx.anonymized &&
    (suppressed.byDepartment > 0 ||
      suppressed.byManager > 0 ||
      current.total === null);
  const total = hidden ? null : current.total;
  const points = (d: {
    selfDelta: number | null;
    managerDelta: number | null;
  }) => ({
    self: d.selfDelta,
    manager: d.managerDelta,
  });
  return {
    participants: current.participants,
    byRelationship: total
      ? [
          {
            relationship: "self",
            total: total.selfApplicable,
            submitted: total.selfSubmitted,
          },
          {
            relationship: "manager",
            total: total.managerApplicable,
            submitted: total.managerSubmitted,
          },
        ]
          .filter((r) => r.total > 0)
          .map((r) => ({ ...r, draft: null, declined: null }))
      : null,
    byDepartment: completionRows(departmentCells(current, ctx)),
    byManager: completionRows(teams.cells),
    suppressed,
    delta: delta.previous
      ? {
          previousCycleName: delta.previous.cycleName,
          total: hidden || !delta.total ? null : points(delta.total),
          byDepartment: [
            ...delta.groups.map((d) => ({
              label: d.label ?? ctx.labels.others,
              other: d.key === null,
              ...points(d),
            })),
            ...(delta.others
              ? [
                  {
                    label: ctx.labels.others,
                    other: true,
                    ...points(delta.others),
                  },
                ]
              : []),
          ],
        }
      : null,
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

// ----------------------------------------------------------------- goals

/**
 * Goals of the cycle (#62) from goals-insights: figures by area and by team
 * (the goals of the period, completed / in progress / closed / overdue, mean
 * progress), the buckets of the share of goals completed with the mean
 * indicators of their people, and the outliers (goals and indicators that
 * disagree).
 *
 * Anonymized, it runs as direction with the report's minimum: groups under it
 * are folded into "Otros" or hidden, buckets under it are hidden, teams are
 * "Equipo N" (the module names the manager; the label is replaced here), the
 * outliers are only counted (and only from the minimum) and the totals are
 * null whenever any breakdown has a suppressed group.
 */
export const collectGoals: Collector<"goals"> = async (db, ctx) => {
  const input = { cycleId: ctx.cycleId, config: { minGroupSize: ctx.min } };
  const actor = actorOf(ctx);
  const [all, byManager, teams] = await Promise.all([
    goalInsights(db, actor, { ...input, groupBy: "department" }),
    goalKpis(db, actor, { ...input, groupBy: "manager" }),
    cycleTeams(db, ctx),
  ]);
  const { kpis, vsIndicators: vs, outliers } = all;
  if (kpis.groups.length === 0 && kpis.suppressed === 0) return null;

  const row = (g: GoalKpiGroup, label: string, other: boolean) => ({
    label,
    n: g.people,
    other,
    peopleWithGoals: g.peopleWithGoals,
    goals: g.goals,
    completed: g.completed,
    inProgress: g.inProgress,
    closed: g.closed,
    overdue: g.overdue,
    avgProgress: round(g.avgProgress, 1),
  });
  const rows = (k: GoalKpis, labelOf: (g: GoalKpiGroup) => string) =>
    k.groups.map((g) => {
      const other = g.others || g.key === null;
      return row(g, other ? ctx.labels.others : labelOf(g), other);
    });
  const teamLabel = (g: GoalKpiGroup) =>
    ctx.anonymized
      ? teams.get(g.key!)!
      : (g.label ?? teams.get(g.key!) ?? ctx.labels.others);

  const suppressed = {
    byDepartment: kpis.suppressed,
    byManager: byManager.suppressed,
    buckets: vs.suppressed,
  };
  const hidden =
    ctx.anonymized &&
    (suppressed.byDepartment + suppressed.byManager + suppressed.buckets > 0 ||
      kpis.total === null ||
      byManager.total === null);
  const total = hidden ? null : kpis.total;

  const outlierGroup = (g: typeof outliers.doneButLow) => ({
    count: g.count,
    people: g.people.map((p) => ({
      personId: p.personId,
      name: p.name,
      department: p.department,
      manager: p.managerName,
      goals: p.goals,
      completed: p.completed,
      completedPct: round(p.completedPct, 1)!,
      retention: p.retention,
      engagement: p.engagement,
    })),
  });
  return {
    participantsWithGoals: total?.peopleWithGoals ?? null,
    goals: total?.goals ?? null,
    completed: total?.completed ?? null,
    avgProgress: round(total?.avgProgress ?? null, 1),
    byDepartment: rows(kpis, (g) => g.label ?? ctx.labels.others),
    byManager: rows(byManager, teamLabel),
    buckets: vs.buckets.map((b) => ({
      from: b.from,
      to: b.to,
      people: b.people,
      meanRetention: round(b.meanRetention, 2),
      meanEngagement: round(b.meanEngagement, 2),
      meanPositiveShare: round(b.meanPositiveShare, 2),
      hidden: b.hidden,
    })),
    withoutGoals: vs.withoutGoals,
    outliers: {
      thresholds: outliers.thresholds,
      doneButLow: outlierGroup(outliers.doneButLow),
      behindButHigh: outlierGroup(outliers.behindButHigh),
    },
    suppressed,
  } satisfies GoalsSection;
};

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
