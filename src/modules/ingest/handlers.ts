import { and, eq, isNull, notInArray } from "drizzle-orm";
import type { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { employment, type IngestCounts, type SourceSystem } from "@/db/schema";
import { upsertEmployee } from "./employee";
import {
  stagedJobHistorySchema,
  uniqueNameIndex,
  upsertJobHistory,
} from "./job-history";
import { stagedEmployeeSchema } from "./staging";
import type { Entity, IngestEntity } from "./types";

export type HandlerContext = {
  source: SourceSystem;
  hash: string;
  runId: string;
  /** Per-run scratch space (memoized lookups shared by all records). */
  cache: Map<string, unknown>;
};

export type HandlerOutcome = {
  result: "inserted" | "updated" | "unchanged" | "rejected";
  rejects: string[];
  /** Extra counters added to the run's counts. */
  counts?: Partial<IngestCounts>;
};

/**
 * How runIngest stages and upserts one entity. Adding an entity (goals,
 * reviews...) means adding a handler here; runIngest stays generic.
 */
export type EntityHandler<S> = {
  schema: z.ZodType<S>;
  /** Extra counters, initialised on every run of this entity. */
  counts?: Partial<IngestCounts>;
  upsert(tx: DbOrTx, staged: S, ctx: HandlerContext): Promise<HandlerOutcome>;
  /** After a successful extraction (e.g. soft-delete what was not seen). */
  finish?(
    db: DbOrTx,
    run: { source: SourceSystem; runId: string; seen: Set<string> },
  ): Promise<Partial<IngestCounts>>;
};

/**
 * Landing mode: the record is stored in raw_record and nothing else (no
 * staging, no domain upsert, no soft-delete pass). For entities whose domain
 * mapping does not exist yet (assessments, feedback, goals from files...): the
 * raw rows are kept so mapping them later needs no re-upload. Inserted /
 * unchanged counts come from raw_record itself (same hash = unchanged).
 */
export type LandingHandler = { landing: true };
export const landingHandler: LandingHandler = { landing: true };

const defineHandler = <S>(h: EntityHandler<S>) => h;

/**
 * Entities `runIngest` can stage and upsert. Goals are not here: they need
 * the active employees, lazy comments and owner resolution, so they have
 * their own runner (`runGoalIngest`).
 */
export const entityHandlers: Partial<Record<Entity, EntityHandler<unknown>>> = {
  employee: defineHandler({
    schema: stagedEmployeeSchema,
    async upsert(tx, staged, { source, hash, runId }) {
      const { result, conflicts } = await upsertEmployee(
        tx,
        source,
        staged,
        hash,
        runId,
      );
      return { result, rejects: conflicts };
    },
    // Extractions are full: employments not seen are soft-deleted. An empty
    // extraction is far more likely a broken source, so it never deletes.
    async finish(db, { source, runId, seen }) {
      if (seen.size === 0) return {};
      const now = new Date();
      const deleted = await db
        .update(employment)
        .set({ deletedAt: now, updatedAt: now, ingestRunId: runId })
        .where(
          and(
            eq(employment.sourceSystem, source),
            isNull(employment.deletedAt),
            notInArray(employment.sourceId, [...seen]),
          ),
        )
        .returning({ id: employment.id });
      return { deleted: deleted.length };
    },
  }),
  job_history: defineHandler({
    schema: stagedJobHistorySchema,
    counts: { managerUnresolved: 0 },
    async upsert(tx, staged, { source, hash, runId, cache }) {
      let names = cache.get("uniqueNames") as Map<string, string> | undefined;
      if (!names) {
        names = await uniqueNameIndex(tx);
        cache.set("uniqueNames", names);
      }
      const outcome = await upsertJobHistory(
        tx,
        source,
        staged,
        hash,
        runId,
        names,
      );
      return {
        result: outcome.result,
        rejects: outcome.reason ? [outcome.reason] : [],
        counts: { managerUnresolved: outcome.managerUnresolved },
      };
    },
  }),
};

/**
 * The handler for a run: the landing one, or the entity's domain handler.
 * Throws for an entity that has none (so no run is opened for it).
 */
export function handlerFor(
  entity: IngestEntity,
  landing: boolean,
): EntityHandler<unknown> | LandingHandler {
  if (landing) return landingHandler;
  const handler = (
    entityHandlers as Partial<Record<string, EntityHandler<unknown>>>
  )[entity];
  if (!handler) {
    throw new Error(
      `Unsupported entity ${entity}: it has no domain handler, so its records can only be landed in raw_record (landing mode)`,
    );
  }
  return handler;
}
