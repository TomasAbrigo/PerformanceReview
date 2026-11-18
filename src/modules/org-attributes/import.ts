import { and, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  identityMatchIssue,
  ingestRun,
  personOrgAttribute,
  type IdentityCandidate,
} from "@/db/schema";
import {
  closeOpenIssue,
  openIssueSourceIds,
  raiseIssue,
} from "@/modules/identity/raise";
import { getBuiltinProfile } from "@/modules/lake/profiles";
import { loadSavedProfile } from "@/modules/lake/upload-store";
import { parseReportDate } from "@/modules/import-history/dates";
import { nameIndexOf } from "@/modules/import-history/assessment";
import { matchName } from "@/modules/import-history/names";
import { idIndexOf, matchIds } from "@/modules/import-history/report-identity";
import type { HandlerContext, HandlerOutcome } from "@/modules/ingest/handlers";
import {
  type OrgAttributeKind,
  orgAttributeKinds,
  isPersonKind,
} from "./kinds";

/** The identity queue entity and source of this file's rows. */
export const ORG_ATTRIBUTE_ENTITY = "org_attribute" as const;

/**
 * A row without a `Desde` has held "since ever": the earliest date, so any
 * cycle snapshot is after it.
 */
export const ORG_ATTRIBUTE_EPOCH = "1900-01-01";

const text = (v: string | number | boolean | null) =>
  v === null || String(v).trim() === "" ? null : String(v).trim();

const cell = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : text(v)));

/**
 * A value column of the file: `undefined` when the file has no such column
 * (this import says nothing about it and leaves what is there), `null` when
 * the cell is empty (the file says there is none: the attribute is dropped).
 */
const column = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : text(v)));

/**
 * A row of People's org attributes file (profile `org-attributes`) as
 * FileSourceAdapter hands it over: mapped fields only. Needs the EEID, and at
 * least one of the four values (a column the file does not have is `undefined`,
 * an empty cell `null`: see `column`); `Desde` defaults to "since ever", `Hasta`
 * to open. Dates are ISO, or day/month with the profile's `dateFormat`.
 */
export const stagedOrgAttributeSchema = z
  .object({
    fields: z.object({
      employee_bamboo_id: cell.pipe(z.string({ message: "EEID is empty" })),
      employee_name: cell,
      account: column,
      project: column,
      dm: column,
      santex_lead: column,
      valid_from: z.unknown().optional(),
      valid_to: z.unknown().optional(),
    }),
    dateFormat: z.enum(["mdy", "dmy"]).optional(),
  })
  .transform(({ fields, dateFormat }, ctx) => {
    const date = (label: string, raw: unknown) => {
      const text = raw === null || raw === undefined ? "" : String(raw).trim();
      if (text === "") return null;
      const parsed = parseReportDate(text, dateFormat);
      if (!parsed) {
        ctx.addIssue({
          code: "custom",
          message: `${label} "${text}" is not a date (ISO, or day/month with the profile's dateFormat)`,
        });
      }
      return parsed;
    };
    const from = date("Desde", fields.valid_from);
    const to = date("Hasta", fields.valid_to);
    const rest = {
      employee_bamboo_id: fields.employee_bamboo_id,
      employee_name: fields.employee_name,
      account: fields.account,
      project: fields.project,
      dm: fields.dm,
      santex_lead: fields.santex_lead,
    };
    const validFrom = from ?? ORG_ATTRIBUTE_EPOCH;
    if (to && to < validFrom) {
      ctx.addIssue({
        code: "custom",
        message: `Hasta ${to} is before Desde ${validFrom}`,
      });
    }
    if (!rest.account && !rest.project && !rest.dm && !rest.santex_lead) {
      ctx.addIssue({
        code: "custom",
        message: "The row has no Cuenta, Proyecto, DM or Santex Lead",
      });
    }
    return { fields: rest, validFrom, validTo: to };
  });
export type StagedOrgAttribute = z.infer<typeof stagedOrgAttributeSchema>;

/** The value of each kind in a staged row: undefined, the file has no such column. */
const valueOf = (
  fields: StagedOrgAttribute["fields"],
  kind: OrgAttributeKind,
) => fields[kind];

/** Kinds some row of the run carried a column for: the only ones the run may reconcile. */
const KINDS_KEY = "orgKinds";

/** "Apellido, Nombre" as "Nombre Apellido": the way a DM may be written. */
const asPersonName = (value: string) => {
  const comma = value.indexOf(",");
  return comma < 0
    ? value
    : `${value.slice(comma + 1).trim()} ${value.slice(0, comma).trim()}`;
};

/**
 * Who a DM / Santex Lead cell names: an EEID, employee number or work email
 * that identifies one person, else a name that does (in either order). null
 * when it cannot be told: the value still groups and filters, unresolved.
 */
async function refPersonOf(
  tx: DbOrTx,
  cache: Map<string, unknown>,
  value: string,
): Promise<string | null> {
  // The same DM or lead is on hundreds of rows: resolve each name once per run.
  const key = `orgRef:${value}`;
  if (cache.has(key)) return cache.get(key) as string | null;
  const found = await resolveRef(tx, cache, value);
  cache.set(key, found);
  return found;
}

async function resolveRef(
  tx: DbOrTx,
  cache: Map<string, unknown>,
  value: string,
): Promise<string | null> {
  const ids = await idIndexOf(tx, cache);
  const byId = matchIds(ids, {
    bamboo_id: value,
    employee_number: value,
    work_email: value.includes("@") ? value : null,
  });
  if (byId) return byId;
  const match = matchName(await nameIndexOf(tx, cache), asPersonName(value));
  return "personId" in match ? match.personId : null;
}

/**
 * People a reviewer linked by hand in the identity queue, by the row's
 * source id: they win over the EEID lookup on every later import of the row.
 */
async function linkedPeople(
  tx: DbOrTx,
  cache: Map<string, unknown>,
): Promise<Map<string, string>> {
  let links = cache.get("orgAttributeLinks") as Map<string, string> | undefined;
  if (links) return links;
  const rows = await tx
    .select({
      sourceId: identityMatchIssue.sourceId,
      resolution: identityMatchIssue.resolution,
    })
    .from(identityMatchIssue)
    .where(
      and(
        eq(identityMatchIssue.entity, ORG_ATTRIBUTE_ENTITY),
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
  cache.set("orgAttributeLinks", links);
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

/**
 * One row of the file -> up to four attribute rows of the person its EEID
 * names (Cuenta, Proyecto, DM, Santex Lead), valid from `Desde` to `Hasta`.
 * Idempotent: a row is (person, kind, `Desde`), so the same file again changes
 * nothing, and a corrected `Hasta` or value updates it; a cell emptied since
 * soft-deletes its row. An EEID that matches nobody goes to the identity
 * queue (resolving it with `link` re-runs the row for that person).
 */
export async function upsertOrgAttributes(
  tx: DbOrTx,
  staged: StagedOrgAttribute,
  ctx: HandlerContext,
): Promise<HandlerOutcome> {
  const { fields, validFrom, validTo } = staged;
  const linked = (await linkedPeople(tx, ctx.cache)).get(ctx.sourceId);
  const personId =
    linked ??
    matchIds(await idIndexOf(tx, ctx.cache), {
      bamboo_id: fields.employee_bamboo_id,
    });

  if (!personId) {
    const issue = await raiseIssue(tx, {
      source: ctx.source,
      entity: ORG_ATTRIBUTE_ENTITY,
      sourceId: ctx.sourceId,
      runId: ctx.runId,
      payload: ctx.payload,
      hash: ctx.hash,
      reason: "no_match",
      candidates: await candidatesFor(tx, ctx.cache, fields.employee_name),
    });
    return {
      result: "ignoredIssueId" in issue ? "ignored" : "issues",
      rejects: [],
    };
  }

  // Only rows that had an issue have one to close (one lookup per run).
  let open = ctx.cache.get("openIssues:org_attribute") as
    Set<string> | undefined;
  if (!open) {
    open = await openIssueSourceIds(tx, ctx.source, ORG_ATTRIBUTE_ENTITY);
    ctx.cache.set("openIssues:org_attribute", open);
  }
  if (open.has(ctx.sourceId)) {
    await closeOpenIssue(
      tx,
      {
        source: ctx.source,
        entity: ORG_ATTRIBUTE_ENTITY,
        sourceId: ctx.sourceId,
      },
      { action: "link", auto: true, personId },
    );
    open.delete(ctx.sourceId);
  }

  let inserted = 0;
  let changed = 0;
  // Every attribute this row can say something about, in one read.
  const existingByKind = new Map(
    (
      await tx
        .select()
        .from(personOrgAttribute)
        .where(
          and(
            eq(personOrgAttribute.personId, personId),
            eq(personOrgAttribute.validFrom, validFrom),
          ),
        )
    ).map((row) => [row.kind, row]),
  );
  const kinds =
    (ctx.cache.get(KINDS_KEY) as Set<OrgAttributeKind> | undefined) ??
    new Set<OrgAttributeKind>();
  ctx.cache.set(KINDS_KEY, kinds);
  for (const kind of orgAttributeKinds) {
    const value = valueOf(fields, kind);
    // No such column in the file: not this import's to touch.
    if (value === undefined) continue;
    kinds.add(kind);
    const existing = existingByKind.get(kind);
    if (value === null) {
      if (existing && existing.deletedAt === null) {
        await tx
          .update(personOrgAttribute)
          .set({ deletedAt: new Date(), ingestRunId: ctx.runId })
          .where(eq(personOrgAttribute.id, existing.id));
        changed++;
      }
      continue;
    }
    const refPersonId = isPersonKind(kind)
      ? await refPersonOf(tx, ctx.cache, value)
      : null;
    const row = {
      value,
      validTo,
      refPersonId,
      sourceSystem: ctx.source,
      // The row of the file it came from: what reconciliation looks for.
      sourceId: ctx.sourceId,
      ingestRunId: ctx.runId,
      payloadHash: ctx.hash,
      deletedAt: null,
    };
    if (!existing) {
      await tx
        .insert(personOrgAttribute)
        .values({ ...row, personId, kind, validFrom });
      inserted++;
    } else if (
      existing.deletedAt !== null ||
      existing.value !== value ||
      existing.validTo !== validTo ||
      existing.refPersonId !== refPersonId ||
      existing.sourceId !== ctx.sourceId
    ) {
      await tx
        .update(personOrgAttribute)
        .set(row)
        .where(eq(personOrgAttribute.id, existing.id));
      changed++;
    }
  }
  return {
    result: inserted > 0 ? "inserted" : changed > 0 ? "updated" : "unchanged",
    rejects: [],
  };
}

/**
 * Re-runs the row of an identity issue just settled with `link`: the linked
 * person now answers for its EEID (see `linkedPeople`). false when the stored
 * payload is not a row of this file.
 */
export async function reprocessOrgAttributeRow(
  tx: DbOrTx,
  issue: {
    sourceSystem: HandlerContext["source"];
    payloadHash: string;
    ingestRunId: string;
    sourceId: string;
    payload: unknown;
  },
): Promise<boolean> {
  const staged = stagedOrgAttributeSchema.safeParse(issue.payload);
  if (!staged.success) return false;
  await upsertOrgAttributes(tx, staged.data, {
    source: issue.sourceSystem,
    hash: issue.payloadHash,
    runId: issue.ingestRunId,
    sourceId: issue.sourceId,
    payload: issue.payload,
    cache: new Map(),
  });
  return true;
}

/**
 * After a full read of the file (not an incremental one): the attributes
 * this source wrote that the file no longer has are dropped (soft-deleted).
 * The file is the whole list, so a corrected `Desde` (a new row) or a row that
 * was removed leaves no stale tramo behind. Careful on purpose:
 * - an empty extraction (a broken file) never drops anything;
 * - only the kinds whose column the file has (a file with just `DM` leaves
 *   accounts and projects alone);
 * - a profile marked `partial` (a file that lists only some rows) drops nothing;
 * - rows other sources wrote are never touched, and a dropped row that comes
 *   back in a later file is reinstated.
 */
export async function reconcileOrgAttributes(
  db: DbOrTx,
  run: {
    source: HandlerContext["source"];
    runId: string;
    seen: Set<string>;
    cache: Map<string, unknown>;
  },
): Promise<{ deleted: number }> {
  const kinds = run.cache.get(KINDS_KEY) as Set<OrgAttributeKind> | undefined;
  if (run.seen.size === 0 || !kinds || kinds.size === 0) return { deleted: 0 };
  if (await isPartialRun(db, run.runId)) return { deleted: 0 };
  const dropped = await db
    .update(personOrgAttribute)
    .set({ deletedAt: new Date(), ingestRunId: run.runId })
    .where(
      and(
        eq(personOrgAttribute.sourceSystem, run.source),
        isNull(personOrgAttribute.deletedAt),
        inArray(personOrgAttribute.kind, [...kinds]),
        isNotNull(personOrgAttribute.sourceId),
        notInArray(personOrgAttribute.sourceId, [...run.seen]),
      ),
    )
    .returning({ id: personOrgAttribute.id });
  return { deleted: dropped.length };
}

/**
 * Whether the file lists only some rows: the upload said so (`partial` in the
 * run's params) or the profile it imported with does.
 */
async function isPartialRun(db: DbOrTx, runId: string): Promise<boolean> {
  const [run] = await db
    .select({ params: ingestRun.params })
    .from(ingestRun)
    .where(eq(ingestRun.id, runId));
  if (run?.params?.partial === true) return true;
  const name = run?.params?.profile;
  if (typeof name !== "string") return false;
  const profile =
    getBuiltinProfile(name) ?? (await loadSavedProfile(name).catch(() => null));
  return profile?.partial === true;
}
