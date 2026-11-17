import { desc } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { reviewCycle } from "@/db/schema";
import type { CycleProposal, Deferral } from "@/modules/ingest/handlers";

/** A report row a run held back: found again in raw_record by source id + hash. */
export type DeferredRow = {
  sourceId: string;
  hash: string;
  deferral: Deferral;
};

/** Existing cycles offered, newest first. */
const OPTIONS = 50;

const proposalSchema = z.object({
  name: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
});

/**
 * What a `needs_decision` run asks (stored in `ingest_run.params.decision`):
 * the cycle the held-back rows go to, among the existing cycles or one of the
 * proposed ones (the semester of an ambiguous date, a cycle the file names).
 * `pending` lists the rows; resuming re-processes exactly those.
 */
export const cycleDecisionSchema = z.object({
  kind: z.literal("cycle"),
  rows: z.number(),
  reasons: z.array(z.enum(["ambiguous_semester", "unknown_cycle"])),
  /** Cycle names the rows gave that matched no cycle. */
  names: z.array(z.string()),
  proposals: z.array(proposalSchema),
  options: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      periodStart: z.string(),
      periodEnd: z.string(),
    }),
  ),
  pending: z.array(z.object({ sourceId: z.string(), hash: z.string() })),
  /** Set when someone chose: the cycle the rows went to. */
  resolved: z.object({ cycleId: z.string(), at: z.string() }).optional(),
});
export type CycleDecision = z.infer<typeof cycleDecisionSchema>;

const distinct = <T>(items: T[], key: (item: T) => string): T[] => [
  ...new Map(items.map((item) => [key(item), item])).values(),
];

export async function buildCycleDecision(
  db: DbOrTx,
  deferred: DeferredRow[],
): Promise<CycleDecision> {
  const cycles = await db
    .select({
      id: reviewCycle.id,
      name: reviewCycle.name,
      periodStart: reviewCycle.periodStart,
      periodEnd: reviewCycle.periodEnd,
    })
    .from(reviewCycle)
    .orderBy(desc(reviewCycle.periodEnd), desc(reviewCycle.name))
    .limit(OPTIONS);
  return {
    kind: "cycle",
    rows: deferred.length,
    reasons: [...new Set(deferred.map((d) => d.deferral.reason))].sort(),
    names: [
      ...new Set(
        deferred.flatMap((d) =>
          d.deferral.cycleName ? [d.deferral.cycleName] : [],
        ),
      ),
    ].sort(),
    proposals: distinct(
      deferred.flatMap((d) =>
        d.deferral.proposal ? [d.deferral.proposal] : [],
      ),
      (p: CycleProposal) => p.name,
    ).sort((a, b) => a.periodStart.localeCompare(b.periodStart)),
    options: cycles,
    pending: deferred.map(({ sourceId, hash }) => ({ sourceId, hash })),
  };
}

/** The decision a run waits for, if its params hold one. */
export function decisionOf(
  params: Record<string, unknown> | null | undefined,
): CycleDecision | null {
  const parsed = cycleDecisionSchema.safeParse(params?.decision);
  return parsed.success ? parsed.data : null;
}
