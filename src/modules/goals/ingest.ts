import { and, eq, isNull, notInArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  goal,
  goalComment,
  goalMilestone,
  goalShare,
  ingestRun,
  rawRecord,
  sourceIdentity,
  type Goal,
  type IngestCounts,
  type IngestReject,
  type SourceSystem,
} from "@/db/schema";
import {
  payloadHash,
  type ExtractedRecord,
  type SkippedEmployee,
  type SourceAdapter,
} from "@/modules/ingest";
import { listActiveEmployeeIds } from "@/modules/people/employment";
import {
  stagedCommentSchema,
  stagedGoalSchema,
  type StagedComment,
  type StagedGoal,
} from "./staging";

export type RunGoalIngestInput = {
  adapter: SourceAdapter;
  db: DbOrTx;
  params?: Record<string, unknown>;
};

export type RunGoalIngestResult = { runId: string; counts: IngestCounts };

/** Bamboo employee id → person id, from the open bamboo_id identities. */
async function loadPeopleByBambooId(
  db: DbOrTx,
  source: SourceSystem,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ value: sourceIdentity.value, personId: sourceIdentity.personId })
    .from(sourceIdentity)
    .where(
      and(
        eq(sourceIdentity.sourceSystem, source),
        eq(sourceIdentity.kind, "bamboo_id"),
        isNull(sourceIdentity.validTo),
      ),
    );
  return new Map(rows.map((r) => [r.value, r.personId]));
}

type People = Map<string, string>;

type UpsertInput = {
  source: SourceSystem;
  runId: string;
  staged: StagedGoal;
  ownerPersonId: string;
  existing: Goal | undefined;
  /** Null when the comments were not (re)fetched. */
  comments: StagedComment[] | null;
  /**
   * The count to store with the goal when comments were fetched: Bamboo's own,
   * or only what was stored when some failed staging (so the next run sees the
   * difference and fetches them again).
   */
  commentCount: number;
  hash: string | null;
  sharePersonIds: string[];
  people: People;
};

async function upsertGoal(
  tx: DbOrTx,
  {
    source,
    runId,
    staged,
    ownerPersonId,
    existing,
    comments,
    commentCount,
    hash,
    sharePersonIds,
    people,
  }: UpsertInput,
): Promise<"inserted" | "updated"> {
  const now = new Date();
  const values = {
    personId: ownerPersonId,
    title: staged.title,
    description: staged.description,
    percentComplete: staged.percentComplete,
    status: staged.status,
    dueDate: staged.dueDate,
    completionDate: staged.completionDate,
    lastChangedAt: staged.lastChangedAt,
    alignsWithSourceId: staged.alignsWithSourceId,
    ...(comments ? { commentCount } : {}),
    ingestRunId: runId,
    payloadHash: hash,
    updatedAt: now,
    deletedAt: null,
  };

  let goalId: string;
  if (existing) {
    goalId = existing.id;
    await tx.update(goal).set(values).where(eq(goal.id, goalId));
  } else {
    const [created] = await tx
      .insert(goal)
      .values({ ...values, sourceSystem: source, sourceId: staged.sourceId })
      .returning({ id: goal.id });
    goalId = created.id;
  }

  for (const m of staged.milestones) {
    const row = {
      goalId,
      title: m.title,
      position: m.position,
      completedAt: m.completedAt,
      lastUpdateAt: m.lastUpdateAt,
      ingestRunId: runId,
      updatedAt: now,
      deletedAt: null,
    };
    await tx
      .insert(goalMilestone)
      .values({ ...row, sourceSystem: source, sourceId: m.sourceId })
      .onConflictDoUpdate({
        target: [goalMilestone.sourceSystem, goalMilestone.sourceId],
        set: row,
      });
  }
  const milestoneIds = staged.milestones.map((m) => m.sourceId);
  await tx
    .update(goalMilestone)
    .set({ deletedAt: now, updatedAt: now, ingestRunId: runId })
    .where(
      and(
        eq(goalMilestone.goalId, goalId),
        isNull(goalMilestone.deletedAt),
        milestoneIds.length
          ? notInArray(goalMilestone.sourceId, milestoneIds)
          : undefined,
      ),
    );

  await tx
    .delete(goalShare)
    .where(
      and(
        eq(goalShare.goalId, goalId),
        sharePersonIds.length
          ? notInArray(goalShare.personId, sharePersonIds)
          : undefined,
      ),
    );
  if (sharePersonIds.length) {
    await tx
      .insert(goalShare)
      .values(sharePersonIds.map((personId) => ({ goalId, personId })))
      .onConflictDoNothing();
  }

  if (comments) {
    for (const c of comments) {
      const row = {
        goalId,
        authorPersonId: c.authorEmployeeId
          ? (people.get(c.authorEmployeeId) ?? null)
          : null,
        authorSourceUserId: c.authorSourceUserId,
        text: c.text,
        postedAt: c.postedAt,
        ingestRunId: runId,
        updatedAt: now,
        deletedAt: null,
      };
      await tx
        .insert(goalComment)
        .values({ ...row, sourceSystem: source, sourceId: c.sourceId })
        .onConflictDoUpdate({
          target: [goalComment.sourceSystem, goalComment.sourceId],
          set: row,
        });
    }
    const commentIds = comments.map((c) => c.sourceId);
    await tx
      .update(goalComment)
      .set({ deletedAt: now, updatedAt: now, ingestRunId: runId })
      .where(
        and(
          eq(goalComment.goalId, goalId),
          isNull(goalComment.deletedAt),
          commentIds.length
            ? notInArray(goalComment.sourceId, commentIds)
            : undefined,
        ),
      );
  }

  return existing ? "updated" : "inserted";
}

/** Ids as Bamboo numbers them: 2 before 10. */
const byEmployeeId = (a: string, b: string) =>
  a.localeCompare(b, "en", { numeric: true });

/** One aggregate's view of a goal. */
type Copy = { record: ExtractedRecord; staged: StagedGoal };

/**
 * Who owns a goal listed in several aggregates (the owner's and those of the
 * people it is shared with). Bamboo's aggregate has no owner field, so it is
 * inferred: a copy that lists its own employee among the sharees is a
 * sharee's. If several copies still qualify (a sharee's omits itself), the one
 * listing the most sharees wins, being the owner's full view; a tie is
 * settled by employee id, never by arrival order, and reported.
 * Null when every copy is a sharee's: the owner was not read.
 */
function chooseOwnerCopy(
  copies: Copy[],
): { owner: Copy; tied: string[] } | null {
  const candidates = copies.filter(
    (c) => !c.staged.sharedWithEmployeeIds.includes(c.staged.ownerEmployeeId),
  );
  if (candidates.length === 0) return null;
  const most = Math.max(
    ...candidates.map((c) => c.staged.sharedWithEmployeeIds.length),
  );
  const top = candidates
    .filter((c) => c.staged.sharedWithEmployeeIds.length === most)
    .sort((a, b) =>
      byEmployeeId(a.staged.ownerEmployeeId, b.staged.ownerEmployeeId),
    );
  return {
    owner: top[0],
    tied: top.length > 1 ? top.map((c) => c.staged.ownerEmployeeId) : [],
  };
}

/**
 * Goals of every active employee: raw → staged (zod) → domain upsert,
 * recorded as one ingest_run. Goals are only ever added or updated: a goal
 * Bamboo closes stays here as `closed`, and one that disappears is kept.
 *
 * Change detection is the payload hash (it includes lastChangedDateTime and
 * the comment count). Comments cost one request per goal, so they are only
 * fetched when Bamboo's count differs from the one stored at the last sync.
 *
 * A shared goal is listed in several aggregates: all copies are read first,
 * then `chooseOwnerCopy` picks the owner's.
 *
 * Counts: `read` and `rejected` include every unit that was refused whole (a
 * goal, or an employee whose goals could not be read), one reject entry each.
 * Problems with a goal that is still stored (a comment or share that could
 * not be resolved) are reject entries only; the goal is revisited next run.
 */
export async function runGoalIngest({
  adapter,
  db,
  params = {},
}: RunGoalIngestInput): Promise<RunGoalIngestResult> {
  const source = adapter.source;
  const employeeIds = await listActiveEmployeeIds(db, source);
  const people = await loadPeopleByBambooId(db, source);

  const [run] = await db
    .insert(ingestRun)
    .values({
      sourceSystem: source,
      adapter: adapter.name,
      params: { entity: "goal", ...params },
      status: "running",
    })
    .returning({ id: ingestRun.id });

  const counts: IngestCounts = {
    read: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    deleted: 0,
  };
  const rejects: IngestReject[] = [];

  const saveRaw = (
    entity: string,
    sourceId: string,
    payload: unknown,
    hash: string,
    extractedAt: Date,
  ) =>
    db
      .insert(rawRecord)
      .values({
        runId: run.id,
        sourceSystem: source,
        entity,
        sourceId,
        payload,
        payloadHash: hash,
        extractedAt,
      })
      .onConflictDoNothing();

  /** A unit refused whole: one read, one rejected, one reject entry. */
  const rejectUnit = (reject: IngestReject) => {
    counts.read++;
    counts.rejected++;
    rejects.push(reject);
  };

  async function rejectRecord(record: ExtractedRecord, reject: IngestReject) {
    rejectUnit(reject);
    await saveRaw(
      "goal",
      record.sourceId,
      record.payload,
      payloadHash(record.payload),
      record.extractedAt,
    );
  }

  async function processGoal(
    { record, staged }: Copy,
    issues: string[],
  ): Promise<void> {
    counts.read++;
    const hash = payloadHash(record.payload);
    await saveRaw(
      "goal",
      record.sourceId,
      record.payload,
      hash,
      record.extractedAt,
    );
    const [existing] = await db
      .select()
      .from(goal)
      .where(
        and(eq(goal.sourceSystem, source), eq(goal.sourceId, staged.sourceId)),
      );

    const ownerPersonId = people.get(staged.ownerEmployeeId);
    if (!ownerPersonId) {
      counts.rejected++;
      rejects.push({
        sourceId: record.sourceId,
        reason: `goal owner: no person for Bamboo employee ${staged.ownerEmployeeId}`,
      });
      return;
    }

    const commentsChanged =
      !!record.loadComments &&
      (existing?.commentCount ?? 0) !== staged.commentCount;
    if (
      existing &&
      !existing.deletedAt &&
      existing.payloadHash === hash &&
      !commentsChanged &&
      issues.length === 0
    ) {
      counts.unchanged++;
      return;
    }

    let comments: StagedComment[] | null = null;
    let commentCount = staged.commentCount;
    if (commentsChanged) {
      const rawComments = await record.loadComments!();
      await saveRaw(
        "goal_comment",
        record.sourceId,
        rawComments,
        payloadHash(rawComments),
        record.extractedAt,
      );
      comments = [];
      for (const raw of rawComments) {
        const parsed = stagedCommentSchema.safeParse(raw);
        if (parsed.success) comments.push(parsed.data);
        else issues.push(`goal_comment: ${parsed.error.issues[0]?.message}`);
      }
      // Do not claim comments that were not stored: the difference with
      // Bamboo's count is what makes the next run fetch them again.
      if (comments.length < rawComments.length) commentCount = comments.length;
    }

    const sharePersonIds: string[] = [];
    for (const employeeId of staged.sharedWithEmployeeIds) {
      const personId = people.get(employeeId);
      if (!personId) {
        issues.push(`goal_share: no person for Bamboo employee ${employeeId}`);
      } else if (personId !== ownerPersonId) {
        sharePersonIds.push(personId);
      }
    }

    const result = await db.transaction((tx) =>
      upsertGoal(tx, {
        source,
        runId: run.id,
        staged,
        ownerPersonId,
        existing,
        comments,
        commentCount,
        // Without a hash the goal is revisited next run, once the missing
        // people or comments can be resolved.
        hash: issues.length ? null : hash,
        sharePersonIds,
        people,
      }),
    );
    counts[result]++;
    for (const reason of issues) {
      rejects.push({ sourceId: record.sourceId, reason });
    }
  }

  try {
    // Phase 1: read every aggregate. Goals are grouped by id because a shared
    // goal comes once per person it is shared with.
    const copies = new Map<string, Copy[]>();
    const unreadable = new Map<
      string,
      { record: ExtractedRecord; reason: string }
    >();
    let extractionError: unknown = null;
    let skippedEmployees = 0;
    try {
      const ctx = {
        employeeIds,
        onSkip: ({ employeeId, status }: SkippedEmployee) => {
          skippedEmployees++;
          rejectUnit({
            sourceId: employeeId,
            reason: `goals of employee ${employeeId} not read: Bamboo answered ${status}`,
          });
        },
      };
      for await (const record of adapter.extract(ctx, "goal")) {
        const parsed = stagedGoalSchema.safeParse(record.payload);
        if (parsed.success) {
          const list = copies.get(parsed.data.sourceId) ?? [];
          list.push({ record, staged: parsed.data });
          copies.set(parsed.data.sourceId, list);
        } else if (!unreadable.has(record.sourceId)) {
          unreadable.set(record.sourceId, {
            record,
            reason: parsed.error.issues.map((i) => i.message).join("; "),
          });
        }
      }
      // Everyone refused is a permissions or setup problem, not bad records.
      if (employeeIds.length > 0 && skippedEmployees === employeeIds.length) {
        throw new Error(
          `no employee's goals could be read (Bamboo refused all ${employeeIds.length})`,
        );
      }
    } catch (err) {
      // Keep what was read: the goals stored from it survive the failed run.
      extractionError = err;
    }

    // Phase 2: store.
    for (const [sourceId, { record, reason }] of unreadable) {
      if (!copies.has(sourceId))
        await rejectRecord(record, { sourceId, reason });
    }
    for (const [sourceId, list] of copies) {
      const chosen = chooseOwnerCopy(list);
      if (!chosen) {
        const sharees = list.map((c) => c.staged.ownerEmployeeId).join(", ");
        await rejectRecord(list[0].record, {
          sourceId,
          reason: `goal only seen shared with employee ${sharees}: its owner was not read (owners must be active employees)`,
        });
        continue;
      }
      const issues = chosen.tied.length
        ? [
            `goal owner is ambiguous: listed by employees ${chosen.tied.join(", ")} with the same sharing; chose ${chosen.tied[0]}`,
          ]
        : [];
      await processGoal(chosen.owner, issues);
    }

    if (extractionError) throw extractionError;

    await db
      .update(ingestRun)
      .set({ status: "succeeded", finishedAt: new Date(), counts, rejects })
      .where(eq(ingestRun.id, run.id));
  } catch (err) {
    await db
      .update(ingestRun)
      .set({
        status: "failed",
        finishedAt: new Date(),
        counts,
        rejects,
        error: (err as Error).message,
      })
      .where(eq(ingestRun.id, run.id));
    throw err;
  }

  return { runId: run.id, counts };
}
