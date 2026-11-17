import { and, eq, ilike } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { reviewCycle, type ReviewCycle } from "@/db/schema";
import type { Deferral, HandlerContext } from "@/modules/ingest/handlers";
import { SOURCE, upsertImportedCycle } from "./cycles";
import {
  semesterConfig,
  semesterOf,
  semesterPeriod,
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
export type CycleTarget = { cycle: ReviewCycle } | { deferred: Deferral };

async function cachedConfig(
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
        proposal: {
          name: semester.label,
          periodStart: semester.periodStart,
          periodEnd: semester.periodEnd,
        },
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
  let cycle = ctx.cache.get(key) as ReviewCycle | undefined;
  if (!cycle) {
    cycle = await findImportedCycle(tx, name, { partial: false });
    if (!cycle) {
      const byName = await tx
        .select()
        .from(reviewCycle)
        .where(eq(reviewCycle.name, name));
      cycle = byName.length === 1 ? byName[0] : undefined;
    }
    if (cycle) ctx.cache.set(key, cycle);
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
      proposal: period ? { name, ...period } : null,
    },
  };
}
