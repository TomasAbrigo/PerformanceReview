import { and, eq, gte, ilike, isNull, lte, ne } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { reviewCycle, type ReviewCycle } from "@/db/schema";
import type { Deferral, HandlerContext } from "@/modules/ingest/handlers";
import { SOURCE, upsertImportedCycle } from "./cycles";
import {
  periodCycleName,
  periodCycleNames,
  periodEndFor,
  periodSourceId,
  legacySemesterConfig,
  semesterConfig,
  semesterOf,
  semesterPeriod,
  type Semester,
  type SemesterConfig,
} from "./semester";

/**
 * Which cycle a report row belongs to (issue #58). The row's cycle name
 * first; without one, the semester of its date. A row that cannot be placed
 * for sure (a date near a semester cutoff; an Assessment Progress row naming
 * a cycle that does not exist) is deferred: nothing is written and the run
 * waits for someone to choose (`needs_decision`). Resuming the run passes the
 * chosen cycle as `ctx.forcedCycleId`, used only for those rows.
 */
/** The semester on the other side of the cutoff nearest to `date`. */
function neighbour(date: string, semester: Semester, cfg: SemesterConfig) {
  const day = 86_400_000;
  const t = Date.parse(`${date}T00:00:00Z`);
  const toStart = t - Date.parse(`${semester.periodStart}T00:00:00Z`);
  const toEnd = Date.parse(`${semester.periodEnd}T00:00:00Z`) - t;
  const across =
    toStart <= toEnd
      ? Date.parse(`${semester.periodStart}T00:00:00Z`) - day
      : Date.parse(`${semester.periodEnd}T00:00:00Z`) + day;
  return semesterOf(new Date(across).toISOString().slice(0, 10), cfg);
}

export type CycleTarget = { cycle: ReviewCycle } | { deferred: Deferral };

/** Legacy semester inference (calendar halves), once per run. */
async function cachedConfig(
  tx: DbOrTx,
  cache: Map<string, unknown>,
): Promise<SemesterConfig> {
  let cfg = cache.get("legacySemesterConfig") as SemesterConfig | undefined;
  if (!cfg) {
    cfg = await legacySemesterConfig(tx);
    cache.set("legacySemesterConfig", cfg);
  }
  return cfg;
}

/** Review periods of the real reports (settings `semester.*`), once per run. */
async function cachedPeriodConfig(
  tx: DbOrTx,
  cache: Map<string, unknown>,
): Promise<SemesterConfig> {
  let cfg = cache.get("semesterConfig") as SemesterConfig | undefined;
  if (!cfg) {
    cfg = await semesterConfig(tx);
    cache.set("semesterConfig", cfg);
  }
  return cfg;
}

async function forcedCycle(
  tx: DbOrTx,
  ctx: HandlerContext,
): Promise<ReviewCycle | null> {
  if (!ctx.forcedCycleId) return null;
  const key = `forcedCycle:${ctx.forcedCycleId}`;
  let cycle = ctx.cache.get(key) as ReviewCycle | undefined;
  if (!cycle) {
    [cycle] = await tx
      .select()
      .from(reviewCycle)
      .where(eq(reviewCycle.id, ctx.forcedCycleId));
    if (!cycle) throw new Error(`Cycle ${ctx.forcedCycleId} does not exist`);
    ctx.cache.set(key, cycle);
  }
  return cycle;
}

/** An imported cycle whose source id is `name` or contains it ("2025-H1"). */
async function findImportedCycle(
  tx: DbOrTx,
  name: string,
  { partial }: { partial: boolean },
): Promise<ReviewCycle | undefined> {
  const [exact] = await tx
    .select()
    .from(reviewCycle)
    .where(
      and(eq(reviewCycle.sourceSystem, SOURCE), eq(reviewCycle.sourceId, name)),
    );
  if (exact || !partial) return exact;
  const like = await tx
    .select()
    .from(reviewCycle)
    .where(
      and(
        eq(reviewCycle.sourceSystem, SOURCE),
        ilike(reviewCycle.sourceId, `%${name.replace(/[%_\\]/g, "\\$&")}%`),
      ),
    );
  return like.length === 1 ? like[0] : undefined;
}

/**
 * Employee Performance: the named cycle (created on first sight, period
 * widened by the date), else the semester of the date.
 */
export async function cycleForAssessment(
  tx: DbOrTx,
  ctx: HandlerContext,
  row: { name: string | null; date: string },
): Promise<CycleTarget> {
  if (row.name) {
    return {
      cycle: await upsertImportedCycle(
        tx,
        { name: row.name, date: row.date, runId: ctx.runId, widen: true },
        {},
        ctx.cache,
      ),
    };
  }
  const cfg = await cachedConfig(tx, ctx.cache);
  const semester = semesterOf(row.date, cfg);
  if (semester.ambiguous) {
    const forced = await forcedCycle(tx, ctx);
    if (forced) return { cycle: forced };
    return {
      deferred: {
        reason: "ambiguous_semester",
        cycleName: null,
        // The date's semester and the one across the nearest cutoff.
        proposals: [semester, neighbour(row.date, semester, cfg)]
          .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
          .map((s) => ({
            name: s.label,
            periodStart: s.periodStart,
            periodEnd: s.periodEnd,
          })),
      },
    };
  }
  const key = `semesterCycle:${semester.label}`;
  let named = ctx.cache.get(key) as string | undefined;
  if (!named) {
    const existing = await findImportedCycle(tx, semester.label, {
      partial: true,
    });
    named = existing?.sourceId ?? semester.label;
    ctx.cache.set(key, named);
  }
  return {
    cycle: await upsertImportedCycle(
      tx,
      { name: named, date: row.date, runId: ctx.runId, widen: true },
      {},
      ctx.cache,
    ),
  };
}

/**
 * Assessment Progress has no dates: its cycle must exist already (imported
 * by name, or a cycle with that exact name), else the row is deferred.
 */
export async function cycleForProgress(
  tx: DbOrTx,
  ctx: HandlerContext,
  name: string,
): Promise<CycleTarget> {
  const key = `progressCycle:${name}`;
  // null: looked up already and not found (one lookup per name per run).
  let cycle = ctx.cache.get(key) as ReviewCycle | null | undefined;
  if (cycle === undefined) {
    cycle = await findImportedCycle(tx, name, { partial: false });
    if (!cycle) {
      const byName = await tx
        .select()
        .from(reviewCycle)
        .where(eq(reviewCycle.name, name));
      cycle = byName.length === 1 ? byName[0] : undefined;
    }
    ctx.cache.set(key, cycle ?? null);
  }
  if (cycle) return { cycle };
  const forced = await forcedCycle(tx, ctx);
  if (forced) return { cycle: forced };
  const cfg = await cachedConfig(tx, ctx.cache);
  const period = semesterPeriod(name, cfg);
  return {
    deferred: {
      reason: "unknown_cycle",
      cycleName: name,
      proposals: period ? [{ name, ...period }] : [],
    },
  };
}

/**
 * Bamboo's raw reports (#83): the cycle of a review period, by its start
 * date. Created closed on first sight with the end inferred from the
 * semester settings (periodEndFor) and its snapshot as of the period start,
 * so the participant's manager is the one in force when the period opened
 * (reviewer mismatches are against it). Never widened by later rows.
 */
export async function cycleForPeriod(
  tx: DbOrTx,
  ctx: HandlerContext,
  periodStart: string,
  /** The end the report gives (Assessment Progress), else inferred. */
  givenEnd: string | null = null,
): Promise<ReviewCycle> {
  const sourceId = periodSourceId(periodStart);
  const key = `cycle:${sourceId}`;
  const cached = ctx.cache.get(key) as ReviewCycle | undefined;
  if (cached) return cached;
  // A cycle run in the app over this period takes Bamboo's reviews (#106).
  const native = await nativeCycleCovering(tx, periodStart);
  if (native) {
    ctx.cache.set(key, native);
    return native;
  }
  let [cycle] = await tx
    .select()
    .from(reviewCycle)
    .where(
      and(
        eq(reviewCycle.sourceSystem, SOURCE),
        eq(reviewCycle.sourceId, sourceId),
      ),
    );
  if (!cycle) {
    const periodEnd =
      givenEnd && givenEnd >= periodStart
        ? givenEnd
        : periodEndFor(periodStart, await cachedPeriodConfig(tx, ctx.cache));
    [cycle] = await tx
      .insert(reviewCycle)
      .values({
        name: periodCycleName(periodStart, periodEnd),
        localizedName: periodCycleNames(periodStart, periodEnd),
        periodStart,
        periodEnd,
        snapshotDate: periodStart,
        status: "closed",
        components: {
          self: true,
          manager: true,
          peer: false,
          upward: false,
          calibration: false,
        },
        anonymity: { peer: "transparent", upward: "transparent" },
        templateId: null,
        sourceSystem: SOURCE,
        sourceId,
        ingestRunId: ctx.runId,
      })
      .returning();
  }
  ctx.cache.set(key, cycle);
  return cycle;
}

/**
 * The cycle launched in the app (not a draft, not deleted) whose period holds
 * `date`, when exactly one does: Bamboo's reviews of that period overwrite
 * the ones written there instead of opening a cycle of their own.
 */
async function nativeCycleCovering(
  tx: DbOrTx,
  date: string,
): Promise<ReviewCycle | undefined> {
  const found = await tx
    .select()
    .from(reviewCycle)
    .where(
      and(
        eq(reviewCycle.sourceSystem, "native"),
        ne(reviewCycle.status, "draft"),
        isNull(reviewCycle.deletedAt),
        lte(reviewCycle.periodStart, date),
        gte(reviewCycle.periodEnd, date),
      ),
    );
  return found.length === 1 ? found[0] : undefined;
}
