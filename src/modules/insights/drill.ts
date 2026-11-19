import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { loadSides } from "@/modules/analytics/completion/queries";
import { isMissing } from "@/modules/analytics/completion/types";
import { ALL_PEOPLE } from "@/modules/analytics/dashboards/scope";
import { filterRows } from "@/modules/analytics/goals-insights/derive";
import { loadParticipantRows } from "@/modules/analytics/goals-insights/rows";
import { goalContext } from "@/modules/analytics/goals-insights/scope";
import { matches } from "@/modules/analytics/indicators/compute";
import {
  indicatorContext,
  loadRows,
  requireCycle,
} from "@/modules/analytics/indicators/rows";
import { bandOf } from "@/modules/analytics/indicators/types";
import type { OrgFilters } from "@/modules/org-attributes/kinds";
import {
  listComments,
  sentimentByDimension,
  sentimentTotals,
  topThemes,
} from "@/modules/qualitative-analysis/queries";
import type { QualitativeFilters } from "@/modules/qualitative-analysis/types";
import {
  type Sentiment,
  sentiments,
} from "@/modules/qualitative-analysis/constants";
import { ReviewError } from "@/modules/review-core/review-errors";
import { insightsScope } from "./authz";
import {
  type CommentScope,
  type Drill,
  type DrillGroup,
  type DrillGroupBy,
  maskBreakdown,
} from "./drill-spec";
import { engagementPeople } from "@/modules/analytics/engagement/queries";
import {
  isPersonKind,
  type OrgDims,
  orgDimOf,
} from "@/modules/org-attributes/kinds";

/** The figures a person row can carry (message keys of `Drill.fact`). */
export type DrillFact =
  | "retention"
  | "engagement"
  | "selfStatus"
  | "managerStatus"
  | "goals"
  | "completed"
  | "overdue"
  // quant (#117): the monthly engagement.
  | "score"
  | "segment";

/** A person behind a mark: who, where, and the figures that put them there. */
export type DrillPerson = {
  personId: string;
  name: string;
  department: string | null;
  managerName: string | null;
  /** The figures, keyed by message key of `Drill.fact` (e.g. retention: 2). */
  facts: { key: DrillFact; value: string | number }[];
  /** Their detail page (app path without locale), if any. */
  href: string | null;
};

/** A comment behind a mark (never for direction). */
export type DrillComment = {
  answerId: string;
  personName: string;
  dimension: string;
  sentiment: Sentiment;
  text: string;
};

/**
 * The records that form one chart mark or KPI, as the actor may see them.
 * People and managers get the records (`people` or `comments`) with a
 * breakdown; direction gets only the breakdown and the total, masked by the
 * minimum group size (`total` null when it would give a small group away).
 */
export type DrillResult = {
  drill: Drill;
  unit: "people" | "comments";
  total: number | null;
  people: DrillPerson[] | null;
  comments: DrillComment[] | null;
  /** Counts per area (people) or per sentiment (comments). */
  breakdownBy: "department" | "sentiment";
  breakdown: DrillGroup[];
  /** The minimum applied (direction), else null. */
  minGroupSize: number | null;
  /** Where the full view of these records lives (app path), if any. */
  moreHref: string | null;
  /** More records than listed (comments: the first COMMENT_LIMIT). */
  truncated: boolean;
};

export type DrillInput = {
  cycleId: string;
  drill: Drill;
  /** The `aggregation.minGroupSize` setting, read once per request. */
  minGroupSize: number;
  /** The page's org cuts; People and managers only (direction reads everything). */
  filters?: OrgFilters;
};

type Ctx = DrillInput & {
  db: DbOrTx;
  actor: ActorContext;
  /** Null: names allowed (People, a manager); else direction's minimum. */
  min: number | null;
  filters: OrgFilters;
};

const trendHref = (personId: string) =>
  `/insights/indicators/trend?person=${personId}`;

/** People records (or, masked, only their areas) into a result. */
function peopleResult(
  ctx: Ctx,
  people: DrillPerson[],
  moreHref: string | null,
): DrillResult {
  const { total, groups } = maskBreakdown(
    people.map((p) => p.department),
    ctx.min,
  );
  return {
    drill: ctx.drill,
    unit: "people",
    total,
    people: ctx.min === null ? people : null,
    comments: null,
    breakdownBy: "department",
    breakdown: groups,
    minGroupSize: ctx.min,
    moreHref,
    truncated: false,
  };
}

async function indicatorPeople(
  ctx: Ctx,
  drill: Extract<Drill, { kind: "indicator" | "risk" | "indicatorGroup" }>,
) {
  const ictx = await indicatorContext(ctx.db, ctx.actor, {
    minGroupSize: ctx.minGroupSize,
  });
  await requireCycle(ctx.db, ctx.cycleId);
  const rows = (
    await loadRows(ctx.db, ictx, { cycleId: ctx.cycleId, hierarchy: "asOf" })
  ).filter(
    (r) =>
      r.cycleId === ctx.cycleId &&
      matches(r, ctx.filters) &&
      (drill.kind !== "indicatorGroup" || inGroup(r, drill)),
  );
  const byPerson = new Map<
    string,
    { row: (typeof rows)[number]; values: Record<string, number> }
  >();
  for (const r of rows) {
    const p = byPerson.get(r.personId) ?? { row: r, values: {} };
    p.values[r.indicator] = r.value;
    byPerson.set(r.personId, p);
  }
  const threshold = ictx.config.riskThreshold;
  const people: DrillPerson[] = [];
  for (const { row, values } of byPerson.values()) {
    const { retention, engagement } = values;
    const inMark =
      drill.kind === "indicator" || drill.kind === "indicatorGroup"
        ? drill.value === null
          ? values[drill.indicator] !== undefined
          : values[drill.indicator] === drill.value
        : retention !== undefined &&
          engagement !== undefined &&
          bandOf(retention, threshold) === drill.retention &&
          bandOf(engagement, threshold) === drill.engagement;
    if (!inMark) continue;
    people.push({
      personId: row.personId,
      name: row.name,
      department: row.department,
      managerName: row.managerName,
      facts: [
        ...(retention !== undefined
          ? [{ key: "retention" as const, value: retention }]
          : []),
        ...(engagement !== undefined
          ? [{ key: "engagement" as const, value: engagement }]
          : []),
      ],
      href: trendHref(row.personId),
    });
  }
  return peopleResult(ctx, byName(people), "/insights/indicators");
}

async function completionPeople(
  ctx: Ctx,
  drill: Extract<Drill, { kind: "completion" | "completionGroup" }>,
) {
  await requireCycle(ctx.db, ctx.cycleId);
  // Authorized by the caller: direction reads everybody, masked afterwards.
  const rows = await loadSides(
    ctx.db,
    ctx.min === null ? ctx.actor : ALL_PEOPLE,
    { cycleId: ctx.cycleId, hierarchy: "asOf", ...ctx.filters },
    { email: false },
  );
  const people = rows
    .filter((r) => drill.kind !== "completionGroup" || inGroup(r, drill))
    .filter((r) => {
      const status = drill.side === "self" ? r.selfStatus : r.managerStatus;
      return drill.state === "submitted"
        ? status === "submitted"
        : isMissing(status);
    })
    .map((r): DrillPerson => ({
      personId: r.personId,
      name: r.name,
      department: r.department,
      managerName: r.managerName,
      facts: [
        { key: "selfStatus", value: r.selfStatus },
        { key: "managerStatus", value: r.managerStatus },
      ],
      href: `/assessments/${ctx.cycleId}/${r.participantId}`,
    }));
  return peopleResult(
    ctx,
    byName(people),
    `/insights/completion?cycle=${ctx.cycleId}`,
  );
}

async function goalPeople(ctx: Ctx, drill: Extract<Drill, { kind: "goals" }>) {
  const gctx = await goalContext(ctx.db, ctx.actor, ctx.cycleId, {
    minGroupSize: ctx.minGroupSize,
  });
  const rows = filterRows(
    await loadParticipantRows(ctx.db, gctx, {
      hierarchy: "asOf",
      sentiment: false,
    }),
    ctx.filters,
  );
  const people = rows
    .filter((r) =>
      drill.state === "completed"
        ? r.completed > 0
        : drill.state === "overdue"
          ? r.overdue > 0
          : r.goals > 0,
    )
    .map((r): DrillPerson => ({
      personId: r.personId,
      name: r.name,
      department: r.department,
      managerName: r.managerName,
      facts: [
        { key: "goals", value: r.goals },
        { key: "completed", value: r.completed },
        { key: "overdue", value: r.overdue },
      ],
      href: `/goals?q=${encodeURIComponent(r.name)}`,
    }));
  return peopleResult(
    ctx,
    byName(people),
    `/insights/goals?cycle=${ctx.cycleId}`,
  );
}

async function commentRecords(
  ctx: Ctx,
  drill: Extract<Drill, { kind: "theme" | "sentiment" }>,
): Promise<DrillResult> {
  const narrow: Record<string, string> =
    drill.kind === "theme"
      ? { theme: drill.theme }
      : { dimension: drill.dimension, sentiment: drill.sentiment };
  const q = new URLSearchParams({ cycle: ctx.cycleId, ...narrow });
  const base = {
    drill,
    unit: "comments" as const,
    people: null,
    breakdownBy: "sentiment" as const,
    minGroupSize: ctx.min,
    moreHref: `/insights/qualitative?${q.toString()}`,
  };
  // The counts come from the aggregate readers (exact, masked for
  // direction by its minimum); the comments themselves only for who may
  // read them, the first COMMENT_LIMIT.
  const f = {
    cycleId: ctx.cycleId,
    aggregateOnly: true,
    ...ctx.filters,
    ...(ctx.min !== null ? { minGroupSize: ctx.min } : {}),
  };
  let total: number | null;
  let breakdown: DrillGroup[];
  if (drill.kind === "theme") {
    const rank = (await topThemes(ctx.db, ctx.actor, f, 1000)).find(
      (t) => t.theme === drill.theme,
    );
    total = rank?.count ?? null;
    breakdown = rank
      ? sentiments
          .filter((k) => rank.sentiment[k] > 0)
          .map((key) => ({ key, others: false, n: rank.sentiment[key] }))
      : [];
  } else {
    const row = (await sentimentByDimension(ctx.db, ctx.actor, f)).find(
      (r) => r.dimension === drill.dimension,
    );
    const n = row?.[drill.sentiment] ?? 0;
    total = row ? n : null;
    breakdown = n > 0 ? [{ key: drill.sentiment, others: false, n }] : [];
  }
  if (ctx.min !== null) {
    return { ...base, total, comments: null, breakdown, truncated: false };
  }
  const rows = await listComments(
    ctx.db,
    ctx.actor,
    { cycleId: ctx.cycleId, ...ctx.filters, ...narrow },
    COMMENT_LIMIT,
  );
  return {
    ...base,
    total: total ?? 0,
    comments: rows.map((r) => ({
      answerId: r.answerId,
      personName: r.personName,
      dimension: r.dimension,
      sentiment: r.sentiment,
      text: r.text,
    })),
    breakdown,
    truncated: (total ?? 0) > rows.length,
  };
}

// ---- quant (#117): group- and month-scoped drills ----

type GroupedRow = OrgDims & {
  department: string | null;
  managerId: string | null;
};

/** Whether a row is in the group a group drill names (raw values, never keys). */
function inGroup(
  r: GroupedRow,
  d: { groupBy: DrillGroupBy; key: string | null },
): boolean {
  const value =
    d.groupBy === "department"
      ? r.department
      : d.groupBy === "manager"
        ? r.managerId
        : orgDimOf(r, d.groupBy);
  return value === d.key;
}

async function engagementRecords(
  ctx: Ctx,
  drill: Extract<Drill, { kind: "engagement" }>,
): Promise<DrillResult> {
  const rows = await engagementPeople(ctx.db, ctx.actor, {
    month: drill.month,
    segment: drill.segment,
    filters: ctx.filters,
    minGroupSize: ctx.minGroupSize,
  });
  const people = rows.map((r): DrillPerson => ({
    personId: r.personId,
    name: r.name,
    department: r.department,
    managerName: r.managerName,
    facts: [
      {
        key: "score",
        value: r.score === null ? "–" : Math.round(r.score * 100),
      },
      { key: "segment", value: r.segment },
    ],
    href: null,
  }));
  const q = new URLSearchParams({ from: drill.month, to: drill.month });
  return peopleResult(ctx, byName(people), `/insights/engagement?${q}`);
}

// ---- qual (#117): comments with a scope, the DM card of the 360 ----

/** The Feedback filters a comment scope stands for (the page's org cuts first). */
function scopeFilters(ctx: Ctx, scope: CommentScope): QualitativeFilters {
  return {
    ...ctx.filters,
    cycleId: scope.cycle,
    dimension: scope.dimension,
    sentiment: scope.sentiment,
    theme: scope.theme,
    relationship: scope.side,
    department: scope.department,
    ...(scope.account ? { account: scope.account } : {}),
    ...(scope.project ? { project: scope.project } : {}),
    ...(scope.dm ? { dm: scope.dm } : {}),
    ...(scope.santexLead ? { santexLead: scope.santexLead } : {}),
    ...(scope.role && scope.value
      ? { indicator: { role: scope.role, value: scope.value } }
      : {}),
  };
}

/** Where the comments of a scope live in full: Feedback with its filters. */
function feedbackHref(scope: CommentScope): string {
  const q = new URLSearchParams();
  const pairs: [string, string | undefined][] = [
    ["cycle", scope.cycle],
    ["dimension", scope.dimension],
    ["sentiment", scope.sentiment],
    ["theme", scope.theme],
    ["side", scope.side],
    ["department", scope.department],
    ["account", scope.account],
    ["project", scope.project],
    ["dm", scope.dm],
    ["santexLead", scope.santexLead],
  ];
  for (const [k, v] of pairs) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `/insights/qualitative?${qs}` : "/insights/qualitative";
}

/**
 * The comments of a scope: counts from the aggregate reader (direction:
 * masked by its minimum, null under it), the comments themselves (the
 * first COMMENT_LIMIT) only for who may read them.
 */
async function scopedComments(
  ctx: Ctx,
  scope: CommentScope,
): Promise<DrillResult> {
  const f = scopeFilters(ctx, scope);
  const totals = await sentimentTotals(ctx.db, ctx.actor, {
    ...f,
    aggregateOnly: true,
    ...(ctx.min !== null ? { minGroupSize: ctx.min } : {}),
  });
  const total = totals ? totals.total : ctx.min === null ? 0 : null;
  const breakdown: DrillGroup[] = totals
    ? sentiments
        .filter((k) => totals[k] > 0)
        .map((key) => ({ key, others: false, n: totals[key] }))
    : [];
  const base = {
    drill: ctx.drill,
    unit: "comments" as const,
    people: null,
    breakdownBy: "sentiment" as const,
    minGroupSize: ctx.min,
    moreHref: feedbackHref(scope),
    total,
    breakdown,
  };
  if (ctx.min !== null) return { ...base, comments: null, truncated: false };
  const rows = await listComments(ctx.db, ctx.actor, f, COMMENT_LIMIT);
  return {
    ...base,
    comments: rows.map((r) => ({
      answerId: r.answerId,
      personName: r.personName,
      dimension: r.dimension,
      sentiment: r.sentiment,
      text: r.text,
    })),
    truncated: (total ?? 0) > rows.length,
  };
}

/**
 * One figure of a DM card (direct scope: the people whose DM attribute is
 * the DM): its people, or its open-text comments. Never for direction,
 * whose cards carry an opaque key instead of the DM.
 */
async function dmRecords(
  ctx: Ctx,
  drill: Extract<Drill, { kind: "dm" }>,
): Promise<DrillResult> {
  if (ctx.min !== null) throw new ReviewError("forbidden");
  const inDm: Ctx = { ...ctx, filters: { ...ctx.filters, dm: drill.dm } };
  switch (drill.metric) {
    case "retention":
    case "engagement":
      return indicatorPeople(inDm, {
        kind: "indicator",
        indicator: drill.metric,
        value: null,
      });
    case "risk":
      return indicatorPeople(inDm, {
        kind: "risk",
        retention: "low",
        engagement: "low",
      });
    case "self":
    case "manager":
      return completionPeople(inDm, {
        kind: "completion",
        side: drill.metric,
        state: "pending",
      });
    case "comments":
      return scopedComments(inDm, { cycle: ctx.cycleId, dm: drill.dm });
  }
}

/** The most comments a drill lists (the full view has them all). */
export const COMMENT_LIMIT = 200;

const byName = (people: DrillPerson[]) =>
  [...people].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "es") || (a.personId < b.personId ? -1 : 1),
  );

/**
 * The records behind one mark of an insights view (see drill-spec.ts). The
 * authorization is authz.ts's `insightsScope`: People read everything (and
 * may narrow by the org cuts), a manager their direct reports of the cycle
 * snapshot, direction only counts (by area or sentiment) of groups of at
 * least the minimum, never a name; anybody else is forbidden.
 */
export async function drillRecords(
  db: DbOrTx,
  actor: ActorContext,
  input: DrillInput,
): Promise<DrillResult> {
  const scope = insightsScope(actor, input.minGroupSize);
  if (scope.kind === "none") throw new ReviewError("forbidden");
  const masked = scope.kind === "aggregatesOnly";
  const ctx: Ctx = {
    ...input,
    db,
    actor,
    min: masked ? scope.minGroupSize : null,
    filters: masked ? {} : (input.filters ?? {}),
  };
  const { drill } = input;
  switch (drill.kind) {
    case "indicator":
    case "risk":
      return indicatorPeople(ctx, drill);
    case "completion":
      return completionPeople(ctx, drill);
    case "goals":
      return goalPeople(ctx, drill);
    case "theme":
    case "sentiment":
      return commentRecords(ctx, drill);
    // quant (#117): direction reads teams by an opaque key, never a person's.
    case "completionGroup":
    case "indicatorGroup":
      if (
        masked &&
        (drill.groupBy === "manager" || isPersonKind(drill.groupBy))
      )
        throw new ReviewError("forbidden");
      return drill.kind === "completionGroup"
        ? completionPeople(ctx, drill)
        : indicatorPeople(ctx, drill);
    case "engagement":
      return engagementRecords(ctx, drill);
    // ---- qual (#117) ----
    case "comments":
      return scopedComments(ctx, drill.scope);
    case "dm":
      return dmRecords(ctx, drill);
  }
}
