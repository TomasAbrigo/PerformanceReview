import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  employment,
  identityMatchIssue,
  person,
  type IdentityCandidate,
  type IdentityIssueReason,
  type IdentityIssueStatus,
  type IdentityMatchIssue,
  type IdentityResolution,
  type SourceSystem,
} from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { upsertEmployee, type Decision } from "@/modules/ingest/employee";
import { stagedEmployeeSchema } from "@/modules/ingest/staging";
import { IdentityError } from "./errors";
import { lockSourceRecord } from "./lock";

/** What a reviewer needs to recognize the row, whatever the source. */
export type PayloadSummary = {
  displayName: string | null;
  employeeNumber: string | null;
  workEmail: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  status: string | null;
};

export function summarizePayload(payload: unknown): PayloadSummary {
  const parsed = stagedEmployeeSchema.safeParse(payload);
  if (parsed.success) {
    const e = parsed.data;
    return {
      displayName: e.displayName,
      employeeNumber: e.employeeNumber,
      workEmail: e.workEmail,
      hireDate: e.hireDate,
      terminationDate: e.terminationDate,
      status: e.status,
    };
  }
  // Report rows (historical import): only a name, under the profile's field.
  const fields = (payload as { fields?: Record<string, unknown> } | null)
    ?.fields;
  const name = fields?.employee_name;
  return {
    displayName: typeof name === "string" ? name : null,
    employeeNumber: null,
    workEmail: null,
    hireDate: null,
    terminationDate: null,
    status: null,
  };
}

export type IssueListItem = {
  id: string;
  reason: IdentityIssueReason;
  status: IdentityIssueStatus;
  sourceSystem: SourceSystem;
  entity: string;
  sourceId: string;
  ingestRunId: string;
  candidateCount: number;
  summary: PayloadSummary;
  resolution: IdentityResolution | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

export type CandidateDetail = IdentityCandidate & {
  displayName: string;
  workEmail: string | null;
  employments: {
    hireDate: string | null;
    terminationDate: string | null;
    status: string | null;
  }[];
};

export type IssueDetailData = IssueListItem & {
  payload: unknown;
  candidates: CandidateDetail[];
  /** Who a resolved issue ended up with (link / create). */
  resolvedPerson: { id: string; displayName: string } | null;
};

const toListItem = (row: IdentityMatchIssue): IssueListItem => ({
  id: row.id,
  reason: row.reason,
  status: row.status,
  sourceSystem: row.sourceSystem,
  entity: row.entity,
  sourceId: row.sourceId,
  ingestRunId: row.ingestRunId,
  candidateCount: row.candidates.length,
  summary: summarizePayload(row.payload),
  resolution: row.resolution,
  createdAt: row.createdAt,
  resolvedAt: row.resolvedAt,
});

/** Open first, then newest (resolved or created), the id breaking ties. */
const SORT_KEY = sql`(extract(epoch from coalesce(${identityMatchIssue.resolvedAt}, ${identityMatchIssue.createdAt})) * 1000000)::bigint`;
const IS_OPEN = sql`(${identityMatchIssue.status} = 'open')`;

const CURSOR = /^([01]):(\d{1,19}):([0-9a-f-]{36})$/;

export type IssuePage = {
  items: IssueListItem[];
  /** Pass as `cursor` to get the next page; null on the last one. */
  nextCursor: string | null;
};

/**
 * Issues in the given status(es): open ones first, then newest history.
 * Paged by keyset (`limit` + `cursor`) so a long history stays cheap; without
 * a limit everything comes back in one page. An unreadable cursor starts over.
 */
export async function listIssues(
  db: DbOrTx,
  {
    status,
    limit,
    cursor,
  }: {
    status: IdentityIssueStatus | IdentityIssueStatus[];
    limit?: number;
    cursor?: string;
  },
): Promise<IssuePage> {
  const after = cursor ? CURSOR.exec(cursor) : null;
  const afterCursor =
    after && isUuid(after[3])
      ? sql`(${IS_OPEN}, ${SORT_KEY}, ${identityMatchIssue.id}) < (${after[1] === "1"}, ${after[2]}::bigint, ${after[3]}::uuid)`
      : undefined;
  const query = db
    .select({
      row: identityMatchIssue,
      sortKey: sql<string>`${SORT_KEY}::text`,
    })
    .from(identityMatchIssue)
    .where(
      and(
        inArray(
          identityMatchIssue.status,
          Array.isArray(status) ? status : [status],
        ),
        afterCursor,
      ),
    )
    .orderBy(
      sql`${IS_OPEN} desc`,
      sql`${SORT_KEY} desc`,
      sql`${identityMatchIssue.id} desc`,
    );
  const rows = await (limit === undefined ? query : query.limit(limit + 1));
  const page = limit === undefined ? rows : rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => toListItem(r.row)),
    nextCursor:
      last && rows.length > page.length
        ? `${last.row.status === "open" ? 1 : 0}:${last.sortKey}:${last.row.id}`
        : null,
  };
}

export async function countOpenIssues(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(identityMatchIssue)
    .where(eq(identityMatchIssue.status, "open"));
  return row.n;
}

async function personNames(db: DbOrTx, ids: string[]) {
  if (ids.length === 0)
    return new Map<string, { displayName: string; workEmail: string | null }>();
  const rows = await db
    .select({
      id: person.id,
      displayName: person.displayName,
      workEmail: person.workEmail,
    })
    .from(person)
    .where(inArray(person.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getIssue(
  db: DbOrTx,
  id: string,
): Promise<IssueDetailData | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(identityMatchIssue)
    .where(eq(identityMatchIssue.id, id));
  if (!row) return null;

  const resolvedId = row.resolution?.personId;
  const ids = [
    ...row.candidates.map((c) => c.personId),
    ...(resolvedId ? [resolvedId] : []),
  ];
  const people = await personNames(db, ids);
  const periods = ids.length
    ? await db
        .select({
          personId: employment.personId,
          hireDate: employment.hireDate,
          terminationDate: employment.terminationDate,
          status: employment.status,
        })
        .from(employment)
        .where(
          and(inArray(employment.personId, ids), isNull(employment.deletedAt)),
        )
        .orderBy(sql`${employment.hireDate} desc nulls last`)
    : [];

  const candidates = row.candidates.flatMap((c) => {
    const p = people.get(c.personId);
    if (!p) return [];
    return [
      {
        ...c,
        displayName: p.displayName,
        workEmail: p.workEmail,
        employments: periods
          .filter((e) => e.personId === c.personId)
          .map(({ hireDate, terminationDate, status }) => ({
            hireDate,
            terminationDate,
            status,
          })),
      },
    ];
  });
  const resolved = resolvedId ? people.get(resolvedId) : undefined;
  return {
    ...toListItem(row),
    payload: row.payload,
    candidates,
    resolvedPerson:
      resolvedId && resolved
        ? { id: resolvedId, displayName: resolved.displayName }
        : null,
  };
}

export type ResolveInput = {
  action: IdentityResolution["action"];
  personId?: string;
  actorNote?: string;
};

const sameDecision = (done: IdentityResolution | null, input: ResolveInput) =>
  done?.action === input.action &&
  (input.action !== "link" || done.personId === input.personId);

/**
 * Settles an open issue. `link` attaches the stored record to an existing
 * person (a rehire gets a new employment and its new Bamboo id), `create`
 * makes a new person, `ignore` leaves the record out. Link and create
 * re-process the stored payload through the normal upsert, all in one
 * transaction. Repeating a resolution is a no-op; a different one is refused.
 * A conflict only needs acknowledging (`ignore`): its record is already applied.
 */
export async function resolveIssue(
  db: DbOrTx,
  issueId: string,
  input: ResolveInput,
): Promise<IdentityMatchIssue> {
  if (!isUuid(issueId)) throw new IdentityError("not_found");
  return db.transaction(async (tx) => {
    // Same lock as an ingest touching this record, taken before the row lock.
    const [peek] = await tx
      .select({
        sourceSystem: identityMatchIssue.sourceSystem,
        entity: identityMatchIssue.entity,
        sourceId: identityMatchIssue.sourceId,
      })
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.id, issueId));
    if (!peek) throw new IdentityError("not_found");
    await lockSourceRecord(tx, peek.sourceSystem, peek.entity, peek.sourceId);
    const [issue] = await tx
      .select()
      .from(identityMatchIssue)
      .where(eq(identityMatchIssue.id, issueId))
      .for("update");
    if (!issue) throw new IdentityError("not_found");
    if (issue.status !== "open") {
      if (sameDecision(issue.resolution, input)) return issue;
      throw new IdentityError("already_resolved");
    }

    const resolution: IdentityResolution = {
      action: input.action,
      ...(input.action === "link" ? { personId: input.personId } : {}),
      ...(input.actorNote ? { actorNote: input.actorNote } : {}),
    };
    const settle = async (r: IdentityResolution) => {
      const [done] = await tx
        .update(identityMatchIssue)
        .set({
          status: r.action === "ignore" ? "ignored" : "resolved",
          resolution: r,
          resolvedAt: new Date(),
        })
        .where(eq(identityMatchIssue.id, issue.id))
        .returning();
      return done;
    };

    if (input.action === "ignore") return settle(resolution);
    if (issue.reason === "conflict") throw new IdentityError("invalid_action");

    let decision: Decision = { action: "create" };
    if (input.action === "link") {
      if (!input.personId) throw new IdentityError("person_required");
      if (!isUuid(input.personId)) throw new IdentityError("not_found");
      const [target] = await tx
        .select({ id: person.id })
        .from(person)
        .where(eq(person.id, input.personId));
      if (!target) throw new IdentityError("not_found");
      decision = { action: "link", personId: target.id };
    }

    const staged = stagedEmployeeSchema.safeParse(issue.payload);
    if (issue.entity !== "employee" || !staged.success) {
      throw new IdentityError("invalid_payload");
    }
    const [applied] = await tx
      .select({ personId: employment.personId })
      .from(employment)
      .where(
        and(
          eq(employment.sourceSystem, issue.sourceSystem),
          eq(employment.sourceId, issue.sourceId),
        ),
      );
    if (
      applied &&
      !(decision.action === "link" && decision.personId === applied.personId)
    ) {
      throw new IdentityError("already_applied");
    }

    // Settled first, so a conflict the row raises on its own is a new issue
    // instead of overwriting this one.
    const settled = await settle(resolution);
    const outcome = await upsertEmployee(tx, issue.sourceSystem, staged.data, {
      runId: issue.ingestRunId,
      hash: issue.payloadHash,
      payload: issue.payload,
      decision,
    });
    return input.action === "create" && outcome.personId
      ? settle({ ...resolution, personId: outcome.personId })
      : settled;
  });
}

export const ignoreIssue = (db: DbOrTx, issueId: string, actorNote?: string) =>
  resolveIssue(db, issueId, { action: "ignore", actorNote });
