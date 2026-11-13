import {
  and,
  asc,
  eq,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  employment,
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
  type SourceAdapter,
} from "@/modules/ingest";
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

/** Bamboo ids of employees that can have live goals: not terminated, not deleted. */
export async function listActiveEmployeeIds(
  db: DbOrTx,
  source: SourceSystem,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ employeeId: employment.sourceId })
    .from(employment)
    .where(
      and(
        eq(employment.sourceSystem, source),
        isNotNull(employment.sourceId),
        isNull(employment.deletedAt),
        or(
          isNull(employment.terminationDate),
          sql`${employment.terminationDate} > current_date`,
        ),
        sql`lower(coalesce(${employment.status}, '')) <> 'inactive'`,
      ),
    )
    .orderBy(asc(employment.sourceId));
  return rows.flatMap((r) => (r.employeeId ? [r.employeeId] : []));
}

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
    ...(comments ? { commentCount: staged.commentCount } : {}),
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

/**
 * Goals of every active employee: raw → staged (zod) → domain upsert,
 * recorded as one ingest_run. Goals are only ever added or updated: a goal
 * Bamboo closes stays here as `closed`, and one that disappears is kept.
 *
 * Change detection is the payload hash (it includes lastChangedDateTime and
 * the comment count). Comments cost one request per goal, so they are only
 * fetched when Bamboo's count differs from the one stored at the last sync.
 *
 * A goal shared with someone is listed in their aggregate too; the owner is
 * the employee who is not in its `sharedWithEmployeeIds`.
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
  const seen = new Set<string>();
  /** Copies read from the aggregate of someone the goal is shared with. */
  const sharedCopies = new Map<string, string>();

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

  async function processGoal(record: ExtractedRecord, staged: StagedGoal) {
    const hash = payloadHash(record.payload);
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
      !commentsChanged
    ) {
      counts.unchanged++;
      return;
    }

    const issues: string[] = [];
    let comments: StagedComment[] | null = null;
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
    for await (const record of adapter.extract({ employeeIds }, "goal")) {
      const parsed = stagedGoalSchema.safeParse(record.payload);
      if (parsed.success) {
        const staged = parsed.data;
        if (staged.sharedWithEmployeeIds.includes(staged.ownerEmployeeId)) {
          sharedCopies.set(staged.sourceId, staged.ownerEmployeeId);
          continue;
        }
        if (seen.has(staged.sourceId)) continue;
      }
      seen.add(record.sourceId);

      counts.read++;
      await saveRaw(
        "goal",
        record.sourceId,
        record.payload,
        payloadHash(record.payload),
        record.extractedAt,
      );
      if (!parsed.success) {
        counts.rejected++;
        rejects.push({
          sourceId: record.sourceId,
          reason: parsed.error.issues.map((i) => i.message).join("; "),
        });
        continue;
      }
      await processGoal(record, parsed.data);
    }

    for (const [sourceId, employeeId] of sharedCopies) {
      if (!seen.has(sourceId)) {
        rejects.push({
          sourceId,
          reason: `goal only seen shared with employee ${employeeId}: its owner was not read (owners must be active employees)`,
        });
      }
    }

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
