import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import {
  identityMatchIssue,
  personOrgAttribute,
  type IdentityCandidate,
} from "@/db/schema";
import {
  closeOpenIssue,
  openIssueSourceIds,
  raiseIssue,
} from "@/modules/identity/raise";
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

const cell = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((v) =>
    v === null || v === undefined || String(v).trim() === ""
      ? null
      : String(v).trim(),
  );

/**
 * A row of People's org attributes file (profile `org-attributes`) as
 * FileSourceAdapter hands it over: mapped fields only. Needs the EEID, and at
 * least one of the four values; `Desde` defaults to "since ever", `Hasta`
 * to open. Dates are ISO, or day/month with the profile's `dateFormat`.
 */
export const stagedOrgAttributeSchema = z
  .object({
    fields: z.object({
      employee_bamboo_id: cell.pipe(z.string({ message: "EEID is empty" })),
      employee_name: cell,
      account: cell,
      project: cell,
      dm: cell,
      santex_lead: cell,
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

/** The value of each kind in a staged row. */
const valueOf = (
  fields: StagedOrgAttribute["fields"],
  kind: OrgAttributeKind,
) => fields[kind];

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
  for (const kind of orgAttributeKinds) {
    const value = valueOf(fields, kind);
    const [existing] = await tx
      .select()
      .from(personOrgAttribute)
      .where(
        and(
          eq(personOrgAttribute.personId, personId),
          eq(personOrgAttribute.kind, kind),
          eq(personOrgAttribute.validFrom, validFrom),
        ),
      );
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
      sourceId: `${ctx.sourceId}#${kind}`,
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
      existing.refPersonId !== refPersonId
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
