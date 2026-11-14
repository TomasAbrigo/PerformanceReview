import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  identityMatchIssue,
  rawRecord,
  type IdentityCandidate,
  type IdentityIssueReason,
  type IdentityResolution,
  type SourceSystem,
} from "@/db/schema";
import type { IngestEntity } from "@/modules/ingest/types";

export type RaiseInput = {
  source: SourceSystem;
  entity: IngestEntity;
  sourceId: string;
  runId: string;
  /** The raw record as extracted. */
  payload: unknown;
  hash: string;
  reason: IdentityIssueReason;
  candidates: IdentityCandidate[];
};

export type RaiseResult =
  /** The issue now waiting in the queue (new, or the same row seen again). */
  | { issueId: string }
  /** A reviewer already chose to ignore exactly this payload. */
  | { ignoredIssueId: string };

/**
 * Puts a record in the queue. A row has one open issue at most (re-running an
 * extraction refreshes it instead of piling up copies) and a payload that was
 * ignored stays ignored until Bamboo sends something different.
 */
export async function raiseIssue(
  tx: DbOrTx,
  input: RaiseInput,
): Promise<RaiseResult> {
  const { source, entity, sourceId, hash } = input;
  const [raw] = await tx
    .select({ id: rawRecord.id })
    .from(rawRecord)
    .where(
      and(
        eq(rawRecord.sourceSystem, source),
        eq(rawRecord.entity, entity),
        eq(rawRecord.sourceId, sourceId),
        eq(rawRecord.payloadHash, hash),
      ),
    );

  const known = await tx
    .select()
    .from(identityMatchIssue)
    .where(
      and(
        eq(identityMatchIssue.sourceSystem, source),
        eq(identityMatchIssue.entity, entity),
        eq(identityMatchIssue.sourceId, sourceId),
        inArray(identityMatchIssue.status, ["open", "ignored"]),
      ),
    );
  const values = {
    ingestRunId: input.runId,
    rawRecordId: raw?.id ?? null,
    payload: input.payload,
    payloadHash: hash,
    reason: input.reason,
    candidates: input.candidates,
  };

  const open = known.find((i) => i.status === "open");
  if (open) {
    await tx
      .update(identityMatchIssue)
      .set(values)
      .where(eq(identityMatchIssue.id, open.id));
    return { issueId: open.id };
  }
  const ignored = known.find(
    (i) => i.status === "ignored" && i.payloadHash === hash,
  );
  if (ignored) return { ignoredIssueId: ignored.id };

  const [created] = await tx
    .insert(identityMatchIssue)
    .values({ ...values, sourceSystem: source, entity, sourceId })
    .returning({ id: identityMatchIssue.id });
  return { issueId: created.id };
}

/** Closes the open issue of a record that applied cleanly after all. */
export async function closeOpenIssue(
  tx: DbOrTx,
  where: { source: SourceSystem; entity: IngestEntity; sourceId: string },
  resolution: IdentityResolution,
) {
  await tx
    .update(identityMatchIssue)
    .set({ status: "resolved", resolution, resolvedAt: new Date() })
    .where(
      and(
        eq(identityMatchIssue.sourceSystem, where.source),
        eq(identityMatchIssue.entity, where.entity),
        eq(identityMatchIssue.sourceId, where.sourceId),
        eq(identityMatchIssue.status, "open"),
      ),
    );
}

/** Source ids that have an open issue: lets an ingest skip per-record lookups. */
export async function openIssueSourceIds(
  tx: DbOrTx,
  source: SourceSystem,
  entity: IngestEntity,
): Promise<Set<string>> {
  const rows = await tx
    .select({ sourceId: identityMatchIssue.sourceId })
    .from(identityMatchIssue)
    .where(
      and(
        eq(identityMatchIssue.sourceSystem, source),
        eq(identityMatchIssue.entity, entity),
        eq(identityMatchIssue.status, "open"),
      ),
    );
  return new Set(rows.map((r) => r.sourceId));
}

/** Whether one source record has an open issue right now. */
export async function hasOpenIssue(
  tx: DbOrTx,
  source: SourceSystem,
  entity: IngestEntity,
  sourceId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: identityMatchIssue.id })
    .from(identityMatchIssue)
    .where(
      and(
        eq(identityMatchIssue.sourceSystem, source),
        eq(identityMatchIssue.entity, entity),
        eq(identityMatchIssue.sourceId, sourceId),
        eq(identityMatchIssue.status, "open"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
