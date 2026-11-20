import { and, eq, isNull, notInArray } from "drizzle-orm";
import type { z } from "zod";
import type { DbOrTx } from "@/db/client";
import type { QuestionMapping } from "@/modules/lake/profiles";
import {
  employment,
  type IngestCounts,
  type IngestReject,
  type SourceSystem,
} from "@/db/schema";
import { openIssueSourceIds } from "@/modules/identity/raise";
import {
  buildCycleDecision,
  finishHistoryImport,
  stagedAnyAssessmentSchema,
  stagedAnyProgressSchema,
  stagedFeedbackSchema,
  upsertAnyAssessment,
  upsertAnyProgress,
  upsertFeedback,
} from "@/modules/import-history";
import type { DeferredRow } from "@/modules/import-history/decision";
import { stagedEngagementSchema, upsertEngagement } from "@/modules/engagement";
import {
  reconcileOrgAttributes,
  stagedOrgAttributeSchema,
  upsertOrgAttributes,
} from "@/modules/org-attributes";
import { upsertEmployee } from "./employee";
import {
  stagedJobHistorySchema,
  loadNameIndex,
  type NameIndex,
  upsertJobHistory,
} from "./job-history";
import { stagedEmployeeSchema } from "./staging";
import type { IngestEntity } from "./types";

export type HandlerContext = {
  source: SourceSystem;
  hash: string;
  runId: string;
  /** The record's source id (its key in the source). */
  sourceId: string;
  /** The record as extracted (kept on an identity issue if one is raised). */
  payload: unknown;
  /** employee: what to do with a record that matches and resembles nobody. */
  unmatched?: "create" | "queue";
  /** Per-run scratch space (memoized lookups shared by all records). */
  cache: Map<string, unknown>;
  /**
   * Report rows: the cycle someone chose for the rows the run could not place
   * (resuming a `needs_decision` run). Used only for rows that would be
   * deferred again; the others resolve their cycle as usual.
   */
  forcedCycleId?: string;
  /**
   * Report rows: the source profile's question mapping. Not part of the
   * payload (hashes stay those of the row); re-processing a stored row gets
   * it again from the run's profile (questionsOfRun).
   */
  questions?: QuestionMapping[];
};

/** A cycle a decision may create: a semester, or a cycle named in the file. */
export type CycleProposal = {
  name: string;
  periodStart: string;
  periodEnd: string;
};

/** Why a report row was held back, and what could be done with it. */
export type Deferral = {
  reason: "ambiguous_semester" | "unknown_cycle";
  /** The cycle name the row gave, if any. */
  cycleName: string | null;
  /** Cycles a decision may create for the row (none: pick an existing one). */
  proposals: CycleProposal[];
};

export type HandlerOutcome = {
  result:
    | "inserted"
    | "updated"
    | "unchanged"
    | "rejected"
    /** employee: held in (or flagged for) the identity queue. */
    | "issues"
    /** employee: held back, a reviewer already ignored this exact record. */
    | "ignored"
    /** Report rows: not written until someone picks their cycle. */
    | "deferred";
  rejects: string[];
  /** With result `deferred`: why, and the cycle it could go to. */
  deferral?: Deferral;
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
    run: {
      source: SourceSystem;
      runId: string;
      seen: Set<string>;
      /** The run's scratch space, as the handler's `upsert` left it. */
      cache: Map<string, unknown>;
      /** Adds an entry to the run's reject log (does not count as rejected). */
      reject: (reject: IngestReject) => void;
    },
  ): Promise<Partial<IngestCounts>>;
  /**
   * What to ask about the rows the run deferred (result `deferred`): stored
   * as `params.decision`, and the run ends in `needs_decision`.
   */
  decide?(db: DbOrTx, deferred: DeferredRow[]): Promise<unknown>;
};

/**
 * Landing mode: the record is stored in raw_record and nothing else (no
 * staging, no domain upsert, no soft-delete pass). For entities whose domain
 * mapping does not exist yet (goals from files...), or files only to be kept:
 * the raw rows are kept so mapping them later needs no re-upload. Inserted /
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
export const entityHandlers: Partial<
  Record<IngestEntity, EntityHandler<unknown>>
> = {
  employee: defineHandler({
    schema: stagedEmployeeSchema,
    counts: { issues: 0, ignored: 0 },
    async upsert(
      tx,
      staged,
      { source, hash, runId, cache, payload, unmatched },
    ) {
      // Saves a lookup per record: only these may have an issue to settle.
      let openIssues = cache.get("openIssues") as Set<string> | undefined;
      if (!openIssues) {
        openIssues = await openIssueSourceIds(tx, source, "employee");
        cache.set("openIssues", openIssues);
      }
      const { result } = await upsertEmployee(tx, source, staged, {
        runId,
        hash,
        payload,
        unmatched,
        openIssues,
      });
      return { result: result === "issue" ? "issues" : result, rejects: [] };
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
    counts: { managerUnresolved: 0, managerResolvedFuzzy: 0 },
    async upsert(tx, staged, { source, hash, runId, cache }) {
      let names = cache.get("nameIndex") as NameIndex | undefined;
      if (!names) {
        names = await loadNameIndex(tx);
        cache.set("nameIndex", names);
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
        counts: {
          managerUnresolved: outcome.managerUnresolved,
          managerResolvedFuzzy: outcome.managerResolvedFuzzy,
        },
      };
    },
  }),
  // Bamboo report exports (files only): historical cycles, see import-history.
  assessment: defineHandler({
    schema: stagedAnyAssessmentSchema,
    counts: { issues: 0, ignored: 0, mismatches: 0 },
    upsert: upsertAnyAssessment,
    finish: async (db, { runId, reject, seen, cache }) =>
      finishHistoryImport(db, {
        runId,
        reject,
        // Only a raw assessments report is a whole list (#132).
        ...(cache.get("assessmentsReport") ? { seen } : {}),
      }),
    decide: buildCycleDecision,
  }),
  assessment_progress: defineHandler({
    schema: stagedAnyProgressSchema,
    counts: { issues: 0, ignored: 0 },
    upsert: upsertAnyProgress,
    finish: async (db, { runId, reject }) => {
      await finishHistoryImport(db, { runId, reject });
      return {};
    },
    decide: buildCycleDecision,
  }),
  // People's org attributes file (files only): see org-attributes.
  org_attribute: defineHandler({
    schema: stagedOrgAttributeSchema,
    counts: { issues: 0, ignored: 0 },
    upsert: upsertOrgAttributes,
    // The file is the whole list: what it no longer has is dropped.
    finish: (db, run) => reconcileOrgAttributes(db, run),
  }),
  // The monthly engagement file (files only): see engagement.
  engagement_monthly: defineHandler({
    schema: stagedEngagementSchema,
    counts: { issues: 0, ignored: 0 },
    upsert: upsertEngagement,
  }),
  feedback: defineHandler({
    schema: stagedFeedbackSchema,
    counts: { issues: 0, ignored: 0 },
    upsert: upsertFeedback,
    finish: async (db, { runId, reject }) => {
      await finishHistoryImport(db, { runId, reject });
      return {};
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
  const handler = entityHandlers[entity];
  if (!handler) {
    throw new Error(
      `Unsupported entity ${entity}: it has no domain handler, so its records can only be landed in raw_record (landing mode)`,
    );
  }
  return handler;
}
