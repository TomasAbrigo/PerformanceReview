/** Test-only builders of org attributes (db tests): rows written straight to the table. */
import { db } from "@/db/client";
import { personOrgAttribute } from "@/db/schema";
import type { OrgAttributeKind } from "./kinds";

export async function insertOrgAttribute(a: {
  personId: string;
  kind: OrgAttributeKind;
  value: string;
  validFrom?: string;
  validTo?: string | null;
  refPersonId?: string | null;
  deleted?: boolean;
}): Promise<void> {
  await db.insert(personOrgAttribute).values({
    personId: a.personId,
    kind: a.kind,
    value: a.value,
    validFrom: a.validFrom ?? "2020-01-01",
    validTo: a.validTo ?? null,
    refPersonId: a.refPersonId ?? null,
    deletedAt: a.deleted ? new Date() : null,
  });
}

/** One person's attributes in one go (open, since ever, unless said). */
export async function setOrgAttributes(
  personId: string,
  attrs: Partial<Record<OrgAttributeKind, string>>,
  options: {
    validFrom?: string;
    validTo?: string | null;
    refs?: Partial<Record<OrgAttributeKind, string>>;
  } = {},
): Promise<void> {
  for (const [kind, value] of Object.entries(attrs) as [
    OrgAttributeKind,
    string,
  ][]) {
    await insertOrgAttribute({
      personId,
      kind,
      value,
      validFrom: options.validFrom,
      validTo: options.validTo,
      refPersonId: options.refs?.[kind] ?? null,
    });
  }
}
