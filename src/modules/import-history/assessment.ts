import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { and, eq, sql } from "drizzle-orm";
import { historyImportRow, identityMatchIssue } from "@/db/schema";
import {
  closeOpenIssue,
  openIssueSourceIds,
  raiseIssue,
} from "@/modules/identity/raise";
import type { HandlerContext, HandlerOutcome } from "@/modules/ingest/handlers";
import {
  answeredCells,
  ensureParticipant,
  ensureQuestions,
  likertOverridesOf,
  saveAnswers,
  SOURCE,
  upsertRequest,
} from "./cycles";
import { parseReportDate } from "./dates";
import {
  loadNameIndex,
  matchName,
  type NameIndex,
  type NameMatch,
} from "./names";
import { cycleForAssessment } from "./cycle-target";
import { detectQuestionColumns, type QuestionColumn } from "./questions";
import { idIndexOf, matchIdsBy, type RowIds } from "./report-identity";

/** EEIDs with an open employee identity case, read once per run. */
async function pendingEmployees(
  tx: DbOrTx,
  cache: Map<string, unknown>,
): Promise<Set<string>> {
  let pending = cache.get("pendingEmployees") as Set<string> | undefined;
  if (!pending) {
    const rows = await tx
      .select({ sourceId: identityMatchIssue.sourceId })
      .from(identityMatchIssue)
      .where(
        and(
          eq(identityMatchIssue.entity, "employee"),
          eq(identityMatchIssue.status, "open"),
        ),
      );
    pending = new Set(rows.map((r) => r.sourceId));
    cache.set("pendingEmployees", pending);
  }
  return pending;
}
import type { QuestionMapping } from "@/modules/lake/profiles";

const cell = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) =>
    v === null || v === undefined || String(v).trim() === ""
      ? null
      : String(v).trim(),
  );

/**
 * A row of Bamboo's Employee Performance report as FileSourceAdapter hands it
 * over (profile `bamboo-employee-performance`): mapped fields, plus the row
 * under its original headers (the question columns).
 */
export const stagedAssessmentSchema = z
  .object({
    fields: z.object({
      employee_name: cell.pipe(z.string({ message: "Employee Name is empty" })),
      manager_name: cell,
      // Without a cycle name, the semester of the Assessment Date (#58).
      review_cycle: cell,
      assessment_date: z.unknown(),
    }),
    raw: z.record(z.string(), z.unknown()),
    dateFormat: z.enum(["mdy", "dmy"]).optional(),
  })
  .transform((row, ctx) => {
    const date = parseReportDate(row.fields.assessment_date, row.dateFormat);
    if (!date) {
      ctx.addIssue({
        code: "custom",
        message: `Assessment Date "${String(row.fields.assessment_date ?? "")}" is missing or not a date (ISO, or day/month with the profile's dateFormat; only Employee Performance rows can be imported as assessments)`,
      });
      return z.NEVER;
    }
    return { ...row, fields: { ...row.fields, assessment_date: date } };
  });
export type StagedAssessment = z.infer<typeof stagedAssessmentSchema>;

/** What one report row did, for the result screen. */
export type RowTally = {
  participantsCreated: number;
  requestsCreated: number;
  /** Existing requests whose content changed (#132). */
  requestsUpdated: number;
  requestsUnchanged: number;
  /** Requests dropped: the corrected file emptied that side (#132). */
  requestsRemoved: number;
  answersCreated: number;
  /** Existing answers that now hold another value (#132). */
  answersUpdated: number;
  answersUnchanged: number;
  /** Answers dropped: the corrected file emptied that cell (#132). */
  answersRemoved: number;
};

export const emptyTally = (): RowTally => ({
  participantsCreated: 0,
  requestsCreated: 0,
  requestsUpdated: 0,
  requestsUnchanged: 0,
  requestsRemoved: 0,
  answersCreated: 0,
  answersUpdated: 0,
  answersUnchanged: 0,
  answersRemoved: 0,
});

/** Adds what writing one side did to the row's tally. */
export function tallySaved(
  tally: RowTally,
  request: "inserted" | "updated",
  saved: {
    created: number;
    updated: number;
    unchanged: number;
    removed: number;
  },
) {
  if (request === "inserted") tally.requestsCreated++;
  else tally.requestsUpdated++;
  tally.answersCreated += saved.created;
  tally.answersUpdated += saved.updated;
  tally.answersUnchanged += saved.unchanged;
  tally.answersRemoved += saved.removed;
}

type SideResult = "inserted" | "updated" | "unchanged" | "superseded";

/**
 * The outcome of a report row for the run (handler) and for the result
 * screen (`recorded`: a row whose every side lost to a later one is
 * `superseded`, not written).
 */
export function rowOutcome(
  issue: { issueId: string } | { ignoredIssueId: string } | null,
  results: SideResult[],
  removed = 0,
): { result: HandlerOutcome["result"]; recorded: string } {
  const result: HandlerOutcome["result"] = issue
    ? "ignoredIssueId" in issue
      ? "ignored"
      : "issues"
    : results.includes("inserted")
      ? "inserted"
      : results.includes("updated") || removed > 0
        ? "updated"
        : "unchanged";
  const recorded =
    !issue && results.length > 0 && results.every((r) => r === "superseded")
      ? "superseded"
      : result;
  return { result, recorded };
}

/** The report entities whose rows import-history maps. */
export type ReportEntity = "assessment" | "assessment_progress" | "feedback";

export async function nameIndexOf(
  tx: DbOrTx,
  cache: Map<string, unknown>,
): Promise<NameIndex> {
  let index = cache.get("nameIndex") as NameIndex | undefined;
  if (!index) {
    index = await loadNameIndex(tx);
    cache.set("nameIndex", index);
  }
  return index;
}

export async function recordRow(
  tx: DbOrTx,
  row: {
    runId: string;
    entity: ReportEntity;
    sourceId: string;
    cycleId: string;
    /** The handler's result, or `superseded` / `removed` (#132). */
    result: string;
    tally: RowTally;
    issueId?: string | null;
  },
) {
  await tx
    .insert(historyImportRow)
    .values({
      runId: row.runId,
      entity: row.entity,
      sourceId: row.sourceId,
      cycleId: row.cycleId,
      result: row.result,
      issueId: row.issueId ?? null,
      ...row.tally,
    })
    // A second row of the file with the same key (#132): counted, not lost.
    .onConflictDoUpdate({
      target: [
        historyImportRow.runId,
        historyImportRow.entity,
        historyImportRow.sourceId,
      ],
      set: {
        duplicates: sql`${historyImportRow.duplicates} + 1`,
        ...Object.fromEntries(
          Object.entries(row.tally).map(([key, n]) => {
            const column = historyImportRow[key as keyof RowTally];
            return [key, sql`${column} + ${n}`];
          }),
        ),
      },
    });
}

/** Which name of a row a person was looked up for. */
export type RowRole = "employee" | "manager" | "reviewer";

/** What an identity issue of a report row keeps besides the row. */
export type ReportIssuePayload = {
  failedRole: RowRole;
  failedName: string;
};

/**
 * Names a reviewer resolved by hand (identity queue, `link`), per row and
 * role: they win over the name index on every later import of the row.
 */
export async function resolvedLinks(
  tx: DbOrTx,
  cache: Map<string, unknown>,
  entity: ReportEntity,
): Promise<Map<string, Partial<Record<RowRole, string>>>> {
  const key = `resolvedLinks:${entity}`;
  let links = cache.get(key) as
    Map<string, Partial<Record<RowRole, string>>> | undefined;
  if (links) return links;
  const rows = await tx
    .select({
      sourceId: identityMatchIssue.sourceId,
      payload: identityMatchIssue.payload,
      resolution: identityMatchIssue.resolution,
    })
    .from(identityMatchIssue)
    .where(
      and(
        eq(identityMatchIssue.sourceSystem, SOURCE),
        eq(identityMatchIssue.entity, entity),
        eq(identityMatchIssue.status, "resolved"),
      ),
    );
  links = new Map();
  for (const row of rows) {
    const role = (row.payload as Partial<ReportIssuePayload> | null)
      ?.failedRole;
    const personId = row.resolution?.personId;
    if (!role || !personId || row.resolution?.action !== "link") continue;
    links.set(row.sourceId, {
      ...links.get(row.sourceId),
      [role]: personId,
    });
  }
  cache.set(key, links);
  return links;
}

/**
 * Who a row is about and who wrote it, by name. Names that do not resolve to
 * exactly one person (and that nobody linked by hand) send the row to the
 * identity queue, never dropped: the issue says which name and role failed.
 */
export async function resolveRow(
  tx: DbOrTx,
  ctx: HandlerContext,
  entity: ReportEntity,
  sourceId: string,
  names: { reviewee: string | null; reviewer: string | null },
  options: {
    /**
     * The row's ids (raw reports, #83): conclusive when one matches; the
     * name then only proposes candidates (the row goes to the queue).
     */
    ids?: RowIds;
    /**
     * A reviewer name that matches nobody is dropped, not an issue (the
     * caller falls back); one that matches several people still is.
     */
    reviewerOptional?: boolean;
  } = {},
) {
  const index = await nameIndexOf(tx, ctx.cache);
  const linked = (await resolvedLinks(tx, ctx.cache, entity)).get(sourceId);
  const reviewerRole: RowRole = entity === "feedback" ? "reviewer" : "manager";
  let byIds = options.ids
    ? matchIdsBy(await idIndexOf(tx, ctx.cache), options.ids)
    : null;
  // An EEID waiting in the employee queue (a rehire not yet decided) is not
  // placed by legajo or email on the person it may not be (#132): the row
  // waits too, and is placed once that case is resolved.
  const eeid = options.ids?.bamboo_id;
  if (
    byIds &&
    byIds.kind !== "bamboo_id" &&
    eeid &&
    (await pendingEmployees(tx, ctx.cache)).has(eeid.trim())
  ) {
    byIds = null;
  }
  const lookup = (role: RowRole, name: string | null): NameMatch => {
    if (linked?.[role]) return { personId: linked[role] };
    if (role === "employee" && options.ids) {
      if (byIds) return { personId: byIds.personId };
      const proposal = name ? matchName(index, name) : null;
      return {
        reason: "no_match",
        candidates: proposal
          ? "personId" in proposal
            ? [{ personId: proposal.personId, score: 0.3, matchedOn: ["name"] }]
            : proposal.candidates
          : [],
      };
    }
    return matchName(index, name ?? "");
  };
  const revieweeName =
    names.reviewee ??
    Object.values(options.ids ?? {}).find((v) => v) ??
    sourceId;
  const reviewee = lookup("employee", names.reviewee);
  const reviewerMatch = names.reviewer
    ? lookup(reviewerRole, names.reviewer)
    : null;
  const reviewer =
    options.reviewerOptional &&
    reviewerMatch &&
    !("personId" in reviewerMatch) &&
    reviewerMatch.reason === "no_match"
      ? null
      : reviewerMatch;
  const failed: (NameMatch & ReportIssuePayload) | null = !(
    "personId" in reviewee
  )
    ? { ...reviewee, failedRole: "employee", failedName: revieweeName }
    : reviewer && !("personId" in reviewer)
      ? { ...reviewer, failedRole: reviewerRole, failedName: names.reviewer! }
      : null;
  let issue: { issueId: string } | { ignoredIssueId: string } | null = null;
  if (failed && !("personId" in failed)) {
    issue = await raiseIssue(tx, {
      source: SOURCE,
      entity,
      sourceId,
      runId: ctx.runId,
      payload: {
        ...(ctx.payload as Record<string, unknown>),
        failedRole: failed.failedRole,
        failedName: failed.failedName,
      },
      hash: ctx.hash,
      reason: failed.reason,
      candidates: failed.candidates,
    });
  } else {
    // Only rows that had an issue have one to close (one lookup per run).
    let open = ctx.cache.get(`openIssues:${entity}`) as Set<string> | undefined;
    if (!open) {
      open = await openIssueSourceIds(tx, SOURCE, entity);
      ctx.cache.set(`openIssues:${entity}`, open);
    }
    if (open.has(sourceId)) {
      await closeOpenIssue(
        tx,
        { source: SOURCE, entity, sourceId },
        {
          action: "link",
          auto: true,
          personId: (reviewee as { personId: string }).personId,
        },
      );
      open.delete(sourceId);
    }
  }
  return {
    revieweeId: "personId" in reviewee ? reviewee.personId : null,
    reviewerId: reviewer && "personId" in reviewer ? reviewer.personId : null,
    /** The reviewer's name is in the queue (ambiguous or unmatched). */
    reviewerFailed: reviewer !== null && !("personId" in reviewer),
    /** An optional reviewer's name that matches nobody (dropped, #132). */
    reviewerUnmatched: reviewerMatch !== null && reviewer === null,
    issue,
  };
}

export function columnsOf(
  cache: Map<string, unknown>,
  headers: string[],
  mapping: QuestionMapping[] = [],
): QuestionColumn[] {
  const key = `columns:${headers.join("\u0000")}:${JSON.stringify(mapping)}`;
  let columns = cache.get(key) as QuestionColumn[] | undefined;
  if (!columns) {
    columns = detectQuestionColumns(headers, mapping);
    cache.set(key, columns);
  }
  return columns;
}

/** Midday UTC of a date: stays on that day in every timezone we show. */
export const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);

/**
 * One Employee Performance row -> imported cycle, its synthesized questions,
 * the participant (snapshot as of period end), the self and manager requests
 * (submitted on the Assessment Date) and their answers.
 */
export async function upsertAssessment(
  tx: DbOrTx,
  staged: StagedAssessment,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  const { fields, raw } = staged;
  const { sourceId } = ctx;
  const date = fields.assessment_date;
  const target = await cycleForAssessment(tx, ctx, {
    name: fields.review_cycle,
    date,
  });
  if ("deferred" in target) {
    return { result: "deferred", rejects: [], deferral: target.deferred };
  }
  const { cycle } = target;
  const cycleName = fields.review_cycle ?? cycle.name;
  const columns = columnsOf(ctx.cache, Object.keys(raw), ctx.questions);
  const revisions = await ensureQuestions(tx, cycle.id, columns, ctx.cache);

  const tally = emptyTally();
  const rejects: string[] = [];
  const { revieweeId, reviewerId, issue } = await resolveRow(
    tx,
    ctx,
    "assessment",
    sourceId,
    { reviewee: fields.employee_name, reviewer: fields.manager_name },
  );

  const results: ("inserted" | "updated" | "unchanged" | "superseded")[] = [];
  let overwritten = 0;
  if (revieweeId) {
    const participant = await ensureParticipant(tx, cycle, revieweeId);
    if (participant.created) tally.participantsCreated++;
    const sides: { side: "self" | "manager"; reviewer: string | null }[] = [
      { side: "self", reviewer: revieweeId },
      { side: "manager", reviewer: reviewerId },
    ];
    for (const { side, reviewer } of sides) {
      if (!reviewer) continue;
      const sideColumns = columns.filter((c) => c.relationship === side);
      const request = await upsertRequest(tx, {
        cycleId: cycle.id,
        participantId: participant.id,
        reviewerPersonId: reviewer,
        relationship: side,
        sourceId: `${sourceId}#${side}`,
        hash: ctx.hash,
        runId: ctx.runId,
        submittedAt: atNoon(date),
        declinedAt: null,
        csvReviewerName:
          side === "manager" ? fields.manager_name : fields.employee_name,
        reviewerMismatch:
          side === "manager" && reviewer !== participant.snapManagerPersonId,
      });
      results.push(request.result);
      if (request.overwroteNative) overwritten++;
      if (request.result === "superseded") {
        rejects.push(
          `A later assessment of ${fields.employee_name} in "${cycleName}" replaces this ${side} review (one per cycle)`,
        );
        continue;
      }
      if (request.result === "unchanged") {
        tally.requestsUnchanged++;
        tally.answersUnchanged += answeredCells(sideColumns, raw);
        continue;
      }
      const saved = await saveAnswers(
        tx,
        request.id,
        sideColumns,
        revisions,
        raw,
        {
          cycleId: cycle.id,
          runId: ctx.runId,
          overrides: await likertOverridesOf(tx, ctx.cache),
        },
      );
      tallySaved(tally, request.result, saved);
      rejects.push(...saved.invalid);
    }
  }
  // TODO(#16): Bamboo has no overall rating; when a profile maps a custom
  // overall-rating column (e.g. `overall_rating`), write it here as the
  // manager-stage final_rating of the participant once #16 adds that table.

  const { result, recorded } = rowOutcome(issue, results);
  await recordRow(tx, {
    runId: ctx.runId,
    entity: "assessment",
    sourceId,
    cycleId: cycle.id,
    result: recorded,
    tally,
    issueId: issue && "issueId" in issue ? issue.issueId : null,
  });
  return {
    result,
    rejects,
    ...(overwritten ? { counts: { nativeOverwritten: overwritten } } : {}),
  };
}
