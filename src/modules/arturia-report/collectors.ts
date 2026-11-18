// Each section of the report is one collector. The named report reads as
// People (DEFAULT_ACTOR: everything); the anonymized one as direction with
// the report's minimum group size, so the analytics layer masks what it
// already knows how to (indicators, executive groups, completion and goals by
// area and team: no manager name, groups under the minimum folded or hidden),
// and this layer adds the rest: "Equipo N" labels for the teams the modules
// leave without a name, no totals next to a suppressed group (no
// reconstruction by difference), re-pseudonymized quotes, no people section.
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { type ActorContext, DEFAULT_ACTOR } from "@/modules/actor/types";
import {
  type CompletionGroup,
  type CompletionSummary,
  completionDelta,
  completionSummary,
} from "@/modules/analytics/completion";
import { bins, executiveSummary } from "@/modules/analytics/dashboards";
import { ALL_PEOPLE, scopedCtes } from "@/modules/analytics/dashboards/scope";
import type { GroupKeyer } from "@/modules/org-attributes/kinds";
import {
  type GoalKpiGroup,
  type GoalKpis,
  goalInsights,
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
import { getSetting } from "@/modules/settings/service";
import { sumBy, teamLabels } from "./anonymize";
import type { Labels } from "./labels";
import type {
  ArturiaSections,
  CompletionSection,
  GoalsSection,
  PersonRow,
  QualitativeSideSection,
} from "./schema";

export type CollectContext = {
  cycleId: string;
  anonymized: boolean;
  /** Smallest group shown: the report's minGroupSize when anonymized, else 1. */
  min: number;
  labels: Labels;
  /**
   * "Equipo N" of each manager of the cycle (see `cycleTeams`): the one label
   * every section gives a team the analytics modules leave without a name.
   */
  teams: ReadonlyMap<string, string>;
  /**
   * "DM N" of each DM of the cycle by their opaque key (see `cycleDms`), for
   * the DMs the analytics modules give direction without a name.
   */
  dms: ReadonlyMap<string, string>;
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

/**
 * The "Equipo N" labels of a cycle's managers (the snapshot's), numbered by
 * their stable id: read once per report, the same in every section.
 */
export async function cycleTeams(
  db: DbOrTx,
  cycleId: string,
  team: string,
): Promise<Map<string, string>> {
  const rows = await db.execute<{ id: string }>(sql`
    select distinct snap_manager_person_id as id from cycle_participant
    where cycle_id = ${cycleId}::uuid and removed_at is null
      and snap_manager_person_id is not null`);
  return teamLabels(
    rows.map((r) => r.id),
    team,
  );
}

/**
 * The "DM N" labels of a cycle's DMs (the org attributes file's, as of each
 * participant's snapshot), numbered by their opaque key, which is what the
 * analytics modules give direction instead of the name.
 */
export async function cycleDms(
  db: DbOrTx,
  cycleId: string,
  dm: string,
  keyOf: GroupKeyer,
): Promise<Map<string, string>> {
  const rows = await db.execute<{ dm: string }>(sql`
    with recursive ${scopedCtes(ALL_PEOPLE, { cycleId, hierarchy: "asOf" })}
    select distinct dm from scoped where dm is not null`);
  return new Map(
    rows
      .map((r) => keyOf(r.dm))
      .sort()
      .map((key, i) => [key, `${dm} ${i + 1}`]),
  );
}

/**
 * The label of a group of the analytics modules: its own (an area, an
 * account, People's manager or DM name), else "Equipo N" for a team that came
 * without a name (direction), else "DM N" for a DM likewise, else "Otros" (the
 * unassigned and folded group, no key).
 */
const groupLabel = (
  g: { key: string | null; label: string | null },
  ctx: CollectContext,
) =>
  g.label ??
  (g.key === null ? undefined : (ctx.teams.get(g.key) ?? ctx.dms.get(g.key))) ??
  ctx.labels.others;

const round = (x: number | null, digits: number) =>
  x === null ? null : Number(x.toFixed(digits));

type CompletionRows = CompletionSection["byDepartment"];

/** The cells of a summary (direction already folded them): groups, then Otros. */
function completionCells(s: CompletionSummary, ctx: CollectContext) {
  const cell = (g: CompletionGroup, label: string, other: boolean) => ({
    label,
    other,
    participants: g.participants,
    selfSubmitted: g.selfSubmitted,
    selfApplicable: g.selfApplicable,
    managerSubmitted: g.managerSubmitted,
    managerApplicable: g.managerApplicable,
  });
  return [
    ...s.groups.map((g) => cell(g, groupLabel(g, ctx), g.key === null)),
    ...(s.others ? [cell(s.others, ctx.labels.others, true)] : []),
  ];
}

/**
 * A row per side of the assessment (self first) of each group, also where it
 * does not apply (`applicable` false, total 0): the rows of every group have
 * the same shape as the totals'.
 */
function completionRows(
  cells: ReturnType<typeof completionCells>,
): CompletionRows {
  return (["self", "manager"] as const).flatMap((relationship) =>
    cells.map((c) => {
      const total =
        relationship === "self" ? c.selfApplicable : c.managerApplicable;
      return {
        label: c.label,
        relationship,
        n: c.participants,
        total,
        submitted:
          relationship === "self" ? c.selfSubmitted : c.managerSubmitted,
        applicable: total > 0,
        other: c.other,
      };
    }),
  );
}

/**
 * Completion of the cycle (#59): how many participants submitted their self
 * and their manager assessment, from the completion module (Assessment
 * Progress first, then the review requests), total, by area and by team, and
 * the change against the semester before. Peer and upward reviews are in
 * the executive progress. A group's n is its participants. `null` when
 * nobody has an assessment that applies (nothing to complete).
 *
 * Anonymized, the module runs as direction with the report's minimum: areas
 * and teams under it are folded into "Otros" or hidden (a team has no name:
 * it is "Equipo N" here), and the totals (and the change of the total) are
 * null whenever any breakdown has a suppressed group.
 */
export const collectCompletion: Collector<"completion"> = async (db, ctx) => {
  const input = {
    cycleId: ctx.cycleId,
    ...(ctx.anonymized ? { minGroupSize: ctx.min } : {}),
  };
  const actor = actorOf(ctx);
  const [delta, byTeam, byAccount, byDm] = await Promise.all([
    completionDelta(db, actor, { ...input, groupBy: "department" }),
    completionSummary(db, actor, { ...input, groupBy: "manager" }),
    completionSummary(db, actor, { ...input, groupBy: "account" }),
    completionSummary(db, actor, { ...input, groupBy: "dm" }),
  ]);
  const current = delta.current;
  if (current.participants === 0) return null;
  const all = current.total;
  if (all && all.selfApplicable + all.managerApplicable === 0) return null;
  const suppressed = {
    byDepartment: current.suppressed,
    byManager: byTeam.suppressed,
    byAccount: byAccount.suppressed,
    byDm: byDm.suppressed,
  };
  // No total next to a suppressed group: the totals above are those of the
  // area and team cuts; account and DM have their own, below.
  const hidden =
    ctx.anonymized &&
    (suppressed.byDepartment > 0 ||
      suppressed.byManager > 0 ||
      current.total === null ||
      byTeam.total === null);
  const total = hidden ? null : current.total;
  const side = (relationship: string, totalOf: number, submitted: number) => ({
    relationship,
    total: totalOf,
    submitted,
    applicable: totalOf > 0,
    draft: null,
    declined: null,
  });
  /** The whole of an org cut, null if it suppresses any group (no differencing within it). */
  const cutTotal = (cut: CompletionSummary) =>
    cut.total && !(ctx.anonymized && cut.suppressed > 0)
      ? (["self", "manager"] as const).map((relationship) => {
          const [of, done] =
            relationship === "self"
              ? [cut.total!.selfApplicable, cut.total!.selfSubmitted]
              : [cut.total!.managerApplicable, cut.total!.managerSubmitted];
          return {
            relationship,
            total: of,
            submitted: done,
            applicable: of > 0,
          };
        })
      : null;
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
          side("self", total.selfApplicable, total.selfSubmitted),
          side("manager", total.managerApplicable, total.managerSubmitted),
        ]
      : null,
    byDepartment: completionRows(completionCells(current, ctx)),
    byManager: completionRows(completionCells(byTeam, ctx)),
    byAccount: completionRows(completionCells(byAccount, ctx)),
    byDm: completionRows(completionCells(byDm, ctx)),
    byAccountTotal: cutTotal(byAccount),
    byDmTotal: cutTotal(byDm),
    suppressed,
    delta: delta.previous
      ? {
          previousCycleName: delta.previous.cycleName,
          total: hidden || !delta.total ? null : points(delta.total),
          byDepartment: [
            ...delta.groups.map((d) => ({
              label: groupLabel(d, ctx),
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
  const distribution = (
    indicator: (typeof indicators)[number],
    groupBy: "department" | "account" | "dm",
  ) =>
    indicatorDistribution(db, actor, {
      cycleId: ctx.cycleId,
      indicator,
      groupBy,
      config,
    });
  const [dists, matrix, alerts, accounts, dms] = await Promise.all([
    Promise.all(indicators.map((i) => distribution(i, "department"))),
    riskMatrix(db, actor, { cycleId: ctx.cycleId, config }),
    indicatorAlerts(db, actor, { cycleId: ctx.cycleId, config }),
    Promise.all(indicators.map((i) => distribution(i, "account"))),
    Promise.all(indicators.map((i) => distribution(i, "dm"))),
  ]);
  if (dists.every((d) => d.series.length === 0 && d.suppressed === 0)) {
    return null;
  }
  const groups = (d: (typeof dists)[number]) =>
    d.series.map((s) => ({
      label:
        s.others || s.key === null
          ? ctx.labels.others
          : (s.label ?? ctx.dms.get(s.key) ?? s.key),
      n: s.n,
      mean: s.mean,
      counts: s.counts,
      other: s.others || s.key === null,
    }));
  return {
    distribution: dists.map((d, i) => {
      // The module already hides a cut's total when any group of it is suppressed.
      const totalOf = (x: (typeof dists)[number]) =>
        x.total
          ? { n: x.total.n, mean: x.total.mean, counts: x.total.counts }
          : null;
      return {
        indicator: d.indicator,
        groups: groups(d),
        byAccount: groups(accounts[i]),
        byDm: groups(dms[i]),
        total: totalOf(d),
        byAccountTotal: totalOf(accounts[i]),
        byDmTotal: totalOf(dms[i]),
        suppressed: d.suppressed,
        suppressedBy: {
          account: accounts[i].suppressed,
          dm: dms[i].suppressed,
        },
      };
    }),
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
 * "Equipo N" (the module gives direction no manager name), the outliers are
 * only counted (and only from the minimum) and the totals are null whenever
 * any breakdown has a suppressed group.
 */
export const collectGoals: Collector<"goals"> = async (db, ctx) => {
  // One load of the participants' rows: areas, teams, buckets and outliers
  // all come off it.
  const all = await goalInsights(db, actorOf(ctx), {
    cycleId: ctx.cycleId,
    config: { minGroupSize: ctx.min },
    groupBy: "department",
    groupBys: ["manager", "account", "dm"],
  });
  const { kpis, vsIndicators: vs, outliers } = all;
  const byManager = all.kpisBy.manager!;
  const byAccount = all.kpisBy.account!;
  const byDm = all.kpisBy.dm!;
  if (kpis.groups.length === 0 && kpis.suppressed === 0) return null;

  const rows = (k: GoalKpis) =>
    k.groups.map((g: GoalKpiGroup) => ({
      label: groupLabel(g, ctx),
      n: g.people,
      other: g.others || g.key === null,
      peopleWithGoals: g.peopleWithGoals,
      goals: g.goals,
      completed: g.completed,
      inProgress: g.inProgress,
      closed: g.closed,
      overdue: g.overdue,
      avgProgress: round(g.avgProgress, 1),
    }));

  const suppressed = {
    byDepartment: kpis.suppressed,
    byManager: byManager.suppressed,
    byAccount: byAccount.suppressed,
    byDm: byDm.suppressed,
    buckets: vs.suppressed,
  };
  // The four totals are those of the area, team and bucket cuts; account and
  // DM have their own (`byAccountTotal`, `byDmTotal`).
  const hidden =
    ctx.anonymized &&
    (suppressed.byDepartment + suppressed.byManager + suppressed.buckets > 0 ||
      kpis.total === null ||
      byManager.total === null);
  const cutTotal = (k: GoalKpis) =>
    k.total && !(ctx.anonymized && k.suppressed > 0)
      ? {
          participantsWithGoals: k.total.peopleWithGoals,
          goals: k.total.goals,
          completed: k.total.completed,
          avgProgress: round(k.total.avgProgress, 1),
        }
      : null;
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
    byDepartment: rows(kpis),
    byManager: rows(byManager),
    byAccount: rows(byAccount),
    byDm: rows(byDm),
    byAccountTotal: cutTotal(byAccount),
    byDmTotal: cutTotal(byDm),
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

type Side = "self" | "manager";

/**
 * Distinct participants per dimension, theme and cycle (the group sizes),
 * counting only the comments of `side` when given, and closed-question
 * answers only when they are in the analysis (`analysis.includeClosed`), as
 * the queries that produce the counts do.
 */
async function qualitativeSizes(
  db: DbOrTx,
  cycleId: string,
  includeClosed: boolean,
  side?: Side,
) {
  const rows = await db.execute<{ kind: string; key: string; n: number }>(sql`
    with ${effectiveCte()},
    l as (
      select eff.dimension, eff.themes, r.cycle_id, r.participant_id
      from eff
      join answer a on a.id = eff.answer_id
      join review_request r on r.id = a.request_id
      join cycle_participant cp on cp.id = r.participant_id
      where r.deleted_at is null and r.status = 'submitted' and cp.removed_at is null
        ${includeClosed ? sql`` : sql`and eff.kind = 'text'`}
        ${side ? sql`and r.relationship = ${side}` : sql``}
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

type Counts = Pick<
  QualitativeSideSection["sentimentByDimension"][number],
  "positive" | "constructive" | "neutral" | "mixed" | "negative" | "total"
>;
const sumCounts = (rows: Counts[]): Counts => ({
  positive: sumBy(rows, (x) => x.positive),
  constructive: sumBy(rows, (x) => x.constructive),
  neutral: sumBy(rows, (x) => x.neutral),
  mixed: sumBy(rows, (x) => x.mixed),
  negative: sumBy(rows, (x) => x.negative),
  total: sumBy(rows, (x) => x.total),
});

/**
 * Sentiment per dimension and top themes of the comments of `side` (all of
 * them without it), computed as People and folded here by distinct
 * participants. `suppressed` counts people (the dimensions and themes left
 * out; a person in several of them counts in each, so it is an upper bound).
 * Anonymized with something suppressed, no total is published (the shown
 * rows would add up to all but the hidden ones).
 */
async function qualitativeSlice(
  db: DbOrTx,
  ctx: CollectContext,
  includeClosed: boolean,
  side: Side | undefined,
  sources: Awaited<ReturnType<typeof pseudonymSources>>,
): Promise<QualitativeSideSection | null> {
  const f = { cycleId: ctx.cycleId, relationship: side, includeClosed };
  const [dims, themes, sizes] = await Promise.all([
    sentimentByDimension(db, DEFAULT_ACTOR, f),
    topThemes(db, DEFAULT_ACTOR, f),
    qualitativeSizes(db, ctx.cycleId, includeClosed, side),
  ]);
  if (!dims.length) return null;
  const others = ctx.labels.others;

  type Dim = QualitativeSideSection["sentimentByDimension"][number] & {
    n: number;
  };
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
        ...sumCounts(rest),
      }),
    },
  );

  type Theme = QualitativeSideSection["topThemes"][number] & { n: number };
  const t = foldGroups<Theme>(
    themes.map((x) => ({
      theme: x.theme,
      count: x.count,
      sentiment: x.sentiment,
      quotes: x.quotes,
      other: false,
      n: sizes.theme.get(x.theme) ?? 0,
    })),
    ctx.min,
    {
      size: (x) => x.n,
      merge: (rest) => ({
        theme: others,
        count: sumBy(rest, (x) => x.count),
        sentiment: sumCounts(rest.map((x) => x.sentiment as Counts)),
        other: true,
        n: Math.max(...rest.map((x) => x.n)),
        quotes: [],
      }),
    },
  );
  const shown = [...d.shown, ...(d.others ? [d.others] : [])];
  const suppressed = d.suppressed + t.suppressed;
  // Quotes come pseudonymized from the qualitative module; run them (and the
  // theme names) through the pseudonymizer again, belt and braces.
  return {
    totals: ctx.anonymized && suppressed > 0 ? null : sumCounts(shown),
    sentimentByDimension: shown.map(withoutN),
    topThemes: [...t.shown, ...(t.others ? [t.others] : [])].map((x) => ({
      ...withoutN(x),
      theme: x.other ? x.theme : pseudonymize([x.theme], sources).texts[0],
      quotes: [...new Set(pseudonymize(x.quotes, sources).texts)],
    })),
    suppressed,
  };
}

/**
 * The qualitative section: the whole cycle (sentiment per dimension, trend
 * over cycles, top themes, five sentiments) and the same cut by side that
 * wrote the comments. The trend keeps only cycles with at least the minimum
 * of people; the people of the ones left out count in `suppressed`.
 */
export const collectQualitative: Collector<"qualitative"> = async (db, ctx) => {
  const includeClosed = await getSetting(db, "analysis.includeClosed");
  const sources = await pseudonymSources(db);
  const [all, self, manager, trend, sizes] = await Promise.all([
    qualitativeSlice(db, ctx, includeClosed, undefined, sources),
    qualitativeSlice(db, ctx, includeClosed, "self", sources),
    qualitativeSlice(db, ctx, includeClosed, "manager", sources),
    sentimentTrend(db, DEFAULT_ACTOR, { includeClosed }),
    qualitativeSizes(db, ctx.cycleId, includeClosed),
  ]);
  if (!all && !trend.length) return null;
  const cycleSize = (id: string) => sizes.cycle.get(id) ?? 0;
  const keptTrend = trend.filter((t) => cycleSize(t.cycleId) >= ctx.min);
  const base = all ?? {
    totals: null,
    sentimentByDimension: [],
    topThemes: [],
    suppressed: 0,
  };
  return {
    ...base,
    trend: keptTrend,
    suppressed:
      base.suppressed +
      sumBy(
        trend.filter((x) => !keptTrend.includes(x)),
        (x) => cycleSize(x.cycleId),
      ),
    bySide: { self, manager },
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
        and eff.kind = 'text' -- comments only, not the closed answers
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
