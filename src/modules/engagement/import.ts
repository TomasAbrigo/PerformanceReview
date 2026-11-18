import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  engagementMonthly,
  identityMatchIssue,
  type IdentityCandidate,
} from "@/db/schema";
import {
  closeOpenIssue,
  openIssueSourceIds,
  raiseIssue,
} from "@/modules/identity/raise";
import { nameIndexOf } from "@/modules/import-history/assessment";
import { matchName } from "@/modules/import-history/names";
import { idIndexOf, matchIds } from "@/modules/import-history/report-identity";
import type { HandlerContext, HandlerOutcome } from "@/modules/ingest/handlers";
import { getSettings } from "@/modules/settings/service";
import {
  type EngagementCutoffs,
  type EngagementSegment,
  parseEngagementMonth,
  parseEngagementScore,
  parseEngagementSegment,
  segmentOfScore,
} from "./kinds";

/** The identity queue entity and source of this file's rows. */
export const ENGAGEMENT_ENTITY = "engagement_monthly" as const;

const text = (v: string | number | boolean | null | undefined) =>
  v === null || v === undefined || String(v).trim() === ""
    ? null
    : String(v).trim();

const cell = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform(text);

/**
 * A row of the monthly engagement file (profile `engagement-monthly`) as
 * FileSourceAdapter hands it over: mapped fields only. Needs the EEID, the
 * month (`YYYY-MM` or `MM/YYYY`) and a score (0-1) or a segment; the segment
 * stays open (null) when the file has none: it is derived from the score on
 * import. A `falta` row has no score.
 */
export const stagedEngagementSchema = z
  .object({
    fields: z.object({
      employee_bamboo_id: cell.pipe(z.string({ message: "EEID is empty" })),
      employee_name: cell,
      month: z.unknown().optional(),
      score: z.unknown().optional(),
      segment: z.unknown().optional(),
    }),
  })
  .transform(({ fields }, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const rawMonth = text(fields.month as string | number | null | undefined);
    const month = rawMonth ? parseEngagementMonth(rawMonth) : null;
    if (!rawMonth) issue("Mes is empty");
    else if (!month) {
      issue(`Mes "${rawMonth}" is not a month (YYYY-MM or MM/YYYY)`);
    }

    const rawScore = text(fields.score as string | number | null | undefined);
    let score = rawScore === null ? null : parseEngagementScore(rawScore);
    if (rawScore !== null && score === null) {
      issue(`Score "${rawScore}" is not a number between 0 and 1`);
    }

    const rawSegment = text(
      fields.segment as string | number | null | undefined,
    );
    const segment =
      rawSegment === null ? null : parseEngagementSegment(rawSegment);
    if (rawSegment !== null && segment === null) {
      issue(
        `Segmento "${rawSegment}" is not Alto, Medio, Regular, Bajo or Falta`,
      );
    }
    if (rawScore === null && rawSegment === null) {
      issue("The row has neither Score nor Segmento");
    }
    // Somebody who did not answer has no score, whatever the cell says.
    if (segment === "falta") score = null;

    return {
      employeeBambooId: fields.employee_bamboo_id,
      employeeName: fields.employee_name,
      month: month ?? "",
      score,
      segment,
    };
  });
export type StagedEngagement = z.infer<typeof stagedEngagementSchema>;

/** The cutoffs of the run (settings, read once per run). */
async function cutoffsOf(
  tx: DbOrTx,
  cache: Map<string, unknown>,
): Promise<EngagementCutoffs> {
  let cutoffs = cache.get("engagementCutoffs") as EngagementCutoffs | undefined;
  if (!cutoffs) {
    const s = await getSettings(tx);
    cutoffs = {
      alto: s["engagement.cutoffAlto"],
      medio: s["engagement.cutoffMedio"],
      regular: s["engagement.cutoffRegular"],
    };
    cache.set("engagementCutoffs", cutoffs);
  }
  return cutoffs;
}

/** The segment a staged row lands in: its own, else the score's, else `falta`. */
export function segmentOf(
  staged: Pick<StagedEngagement, "score" | "segment">,
  cutoffs: EngagementCutoffs,
): EngagementSegment {
  if (staged.segment) return staged.segment;
  return staged.score === null
    ? "falta"
    : segmentOfScore(staged.score, cutoffs);
}

/**
 * People a reviewer linked by hand in the identity queue, by the row's
 * source id: they win over the EEID lookup on every later import of the row.
 */
async function linkedPeople(
  tx: DbOrTx,
  cache: Map<string, unknown>,
): Promise<Map<string, string>> {
  let links = cache.get("engagementLinks") as Map<string, string> | undefined;
  if (links) return links;
  const rows = await tx
    .select({
      sourceId: identityMatchIssue.sourceId,
      resolution: identityMatchIssue.resolution,
    })
    .from(identityMatchIssue)
    .where(
      and(
        eq(identityMatchIssue.entity, ENGAGEMENT_ENTITY),
        eq(identityMatchIssue.status, "resolved"),
      ),
    );
  links = new Map();
  for (const row of rows) {
    if (
      row.resolution?.action === "link" &&
      row.resolution.personId &&
      !row.resolution.auto
    ) {
      links.set(row.sourceId, row.resolution.personId);
    }
  }
  cache.set("engagementLinks", links);
  return links;
}

/** Candidates for an EEID nobody has: the person of that name, if the file has one. */
async function candidatesFor(
  tx: DbOrTx,
  cache: Map<string, unknown>,
  name: string | null,
): Promise<IdentityCandidate[]> {
  if (!name) return [];
  const match = matchName(await nameIndexOf(tx, cache), name);
  return "personId" in match
    ? [{ personId: match.personId, score: 0.3, matchedOn: ["name"] }]
    : match.candidates;
}

/** A score as the numeric(5, 4) column holds it. */
const scoreText = (score: number | null) =>
  score === null ? null : score.toFixed(4);

/**
 * One row of the file -> the engagement of the person its EEID names in that
 * month. Idempotent: a row is (person, month), so the same file again changes
 * nothing and a corrected score or segment updates it. The file adds and
 * corrects months; it never deletes the ones it does not list. An EEID that
 * matches nobody goes to the identity queue (resolving it with `link` re-runs
 * the row for that person).
 */
export async function upsertEngagement(
  tx: DbOrTx,
  staged: StagedEngagement,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  const linked = (await linkedPeople(tx, ctx.cache)).get(ctx.sourceId);
  const personId =
    linked ??
    matchIds(await idIndexOf(tx, ctx.cache), {
      bamboo_id: staged.employeeBambooId,
    });

  if (!personId) {
    const issue = await raiseIssue(tx, {
      source: ctx.source,
      entity: ENGAGEMENT_ENTITY,
      sourceId: ctx.sourceId,
      runId: ctx.runId,
      payload: ctx.payload,
      hash: ctx.hash,
      reason: "no_match",
      candidates: await candidatesFor(tx, ctx.cache, staged.employeeName),
    });
    return {
      result: "ignoredIssueId" in issue ? "ignored" : "issues",
      rejects: [],
    };
  }

  // Only rows that had an issue have one to close (one lookup per run).
  let open = ctx.cache.get("openIssues:engagement_monthly") as
    Set<string> | undefined;
  if (!open) {
    open = await openIssueSourceIds(tx, ctx.source, ENGAGEMENT_ENTITY);
    ctx.cache.set("openIssues:engagement_monthly", open);
  }
  if (open.has(ctx.sourceId)) {
    await closeOpenIssue(
      tx,
      {
        source: ctx.source,
        entity: ENGAGEMENT_ENTITY,
        sourceId: ctx.sourceId,
      },
      { action: "link", auto: true, personId },
    );
    open.delete(ctx.sourceId);
  }

  const segment = segmentOf(staged, await cutoffsOf(tx, ctx.cache));
  const values = {
    score: scoreText(staged.score),
    segment,
    sourceSystem: ctx.source,
    sourceId: ctx.sourceId,
    ingestRunId: ctx.runId,
    payloadHash: ctx.hash,
    deletedAt: null,
  };
  const [existing] = await tx
    .select()
    .from(engagementMonthly)
    .where(
      and(
        eq(engagementMonthly.personId, personId),
        eq(engagementMonthly.month, staged.month),
      ),
    );
  if (!existing) {
    await tx
      .insert(engagementMonthly)
      .values({ ...values, personId, month: staged.month });
    return { result: "inserted", rejects: [] };
  }
  if (
    existing.deletedAt === null &&
    existing.segment === segment &&
    existing.score === values.score &&
    existing.sourceId === ctx.sourceId
  ) {
    return { result: "unchanged", rejects: [] };
  }
  await tx
    .update(engagementMonthly)
    .set(values)
    .where(eq(engagementMonthly.id, existing.id));
  return { result: "updated", rejects: [] };
}

/**
 * Re-runs the row of an identity issue just settled with `link`: the linked
 * person now answers for its EEID (see `linkedPeople`). false when the stored
 * payload is not a row of this file.
 */
export async function reprocessEngagementRow(
  tx: DbOrTx,
  issue: {
    sourceSystem: HandlerContext["source"];
    payloadHash: string;
    ingestRunId: string;
    sourceId: string;
    payload: unknown;
  },
): Promise<boolean> {
  const staged = stagedEngagementSchema.safeParse(issue.payload);
  if (!staged.success) return false;
  await upsertEngagement(tx, staged.data, {
    source: issue.sourceSystem,
    hash: issue.payloadHash,
    runId: issue.ingestRunId,
    sourceId: issue.sourceId,
    payload: issue.payload,
    cache: new Map(),
  });
  return true;
}
