import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { sourceIdentity, type SourceSystem } from "@/db/schema";
import type { StagedEmployee } from "@/modules/ingest/staging";
import { findCandidates } from "./candidates";
import { raiseIssue, type RaiseResult } from "./raise";
import { createPerson } from "./sync";

export type ResolveContext = {
  runId: string;
  /** The raw record, kept on the issue if one is raised. */
  payload: unknown;
  hash: string;
  /**
   * What to do with a record that matches nobody and resembles nobody:
   * `create` a person (default, a new hire) or `queue` it for a human.
   */
  unmatched?: "create" | "queue";
};

export type ResolveResult = { personId: string } | RaiseResult;

/** The person that holds a source's own id (bamboo_id), if any: conclusive. */
export async function findPersonByBambooId(
  tx: DbOrTx,
  source: SourceSystem,
  sourceId: string,
): Promise<string | null> {
  const [match] = await tx
    .select({ personId: sourceIdentity.personId })
    .from(sourceIdentity)
    .where(
      and(
        eq(sourceIdentity.sourceSystem, source),
        eq(sourceIdentity.kind, "bamboo_id"),
        eq(sourceIdentity.value, sourceId),
        isNull(sourceIdentity.validTo),
      ),
    );
  return match?.personId ?? null;
}

/**
 * Identity resolution for a record whose employment we have not seen.
 *
 * 1. The source's own id (bamboo_id) is conclusive: link.
 * 2. Otherwise legajo, normalized email and normalized name + hire date only
 *    propose candidates; any candidate sends the record to the queue, since a
 *    rehire or a duplicate needs a human to confirm.
 * 3. No candidate at all: a brand-new person (or, running strict, an issue
 *    with no candidates).
 */
export async function resolvePerson(
  tx: DbOrTx,
  source: SourceSystem,
  staged: StagedEmployee,
  ctx: ResolveContext,
): Promise<ResolveResult> {
  const byId = await findPersonByBambooId(tx, source, staged.sourceId);
  if (byId) return { personId: byId };

  const candidates = await findCandidates(tx, source, staged);
  if (candidates.length === 0 && (ctx.unmatched ?? "create") === "create") {
    return { personId: await createPerson(tx, staged) };
  }
  return raiseIssue(tx, {
    source,
    entity: "employee",
    sourceId: staged.sourceId,
    runId: ctx.runId,
    payload: ctx.payload,
    hash: ctx.hash,
    reason: candidates.length ? "ambiguous" : "no_match",
    candidates,
  });
}
