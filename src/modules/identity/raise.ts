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
import { payloadHash } from "@/modules/ingest/hash";
import type { Entity } from "@/modules/ingest/types";

export type RaiseInput = {
  source: SourceSystem;
  entity: Entity;
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
    (i) => i.status === "ignored" && payloadHash(i.payload) === hash,
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
  where: { source: SourceSystem; entity: Entity; sourceId: string },
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
