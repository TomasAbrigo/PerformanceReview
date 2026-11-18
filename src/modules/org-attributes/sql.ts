import { type SQL, sql } from "drizzle-orm";
import {
  type OrgAttributeKind,
  type OrgFilters,
  orgAttributeKinds,
} from "./kinds";

/** Lateral alias of a kind in the joins below. */
const alias = (kind: OrgAttributeKind) => sql.raw(`oa_${kind}`);

/**
 * The org attributes of the participants in `cp` (a `cycle_participant`
 * alias), one lateral join per kind: the value held on `date` (valid_from <=
 * date, valid_to open or >= date; the latest start if two overlap; rows
 * People emptied are out). Put after `from cycle_participant cp ...`; the
 * columns come from `orgAttributeColumns`. The one place that says what an
 * attribute "as of" means, for every view that cuts by them. `personColumn`
 * is the person's column of `cp` (a participant's `reviewee_person_id`; the
 * monthly engagement view passes its own `person_id`).
 */
export function orgAttributeJoins(
  cp: string,
  date: SQL,
  personColumn = "reviewee_person_id",
): SQL {
  return sql.join(
    orgAttributeKinds.map(
      (kind) => sql`
      left join lateral (
        select oa.value, oa.ref_person_id
        from person_org_attribute oa
        where oa.person_id = ${sql.raw(`${cp}.${personColumn}`)}
          and oa.kind = ${kind}::org_attribute_kind
          and oa.deleted_at is null
          and oa.valid_from <= ${date}
          and (oa.valid_to is null or oa.valid_to >= ${date})
        order by oa.valid_from desc
        limit 1
      ) ${alias(kind)} on true`,
    ),
    sql``,
  );
}

/**
 * `account`, `project`, `dm`, `santex_lead` (the values) and the people the
 * DM and the Santex Lead resolve to (`dm_ref_person_id`,
 * `santex_lead_ref_person_id`), read off the joins above.
 */
export const orgAttributeColumns = sql`
      oa_account.value as account, oa_project.value as project,
      oa_dm.value as dm, oa_santex_lead.value as santex_lead,
      oa_dm.ref_person_id as dm_ref_person_id,
      oa_santex_lead.ref_person_id as santex_lead_ref_person_id`;

/** The conditions of the org filters over the joins above (empty: no filter). */
export function orgAttributeFilters(f: OrgFilters): SQL[] {
  const by: [OrgAttributeKind, string | undefined][] = [
    ["account", f.account],
    ["project", f.project],
    ["dm", f.dm],
    ["santex_lead", f.santexLead],
  ];
  return by.flatMap(([kind, value]) =>
    value ? [sql`${alias(kind)}.value = ${value}`] : [],
  );
}

/** The columns `scoped` carries for the org attributes, as the rows read them. */
export type OrgAttributeRow = {
  account: string | null;
  project: string | null;
  dm: string | null;
  santex_lead: string | null;
  dm_ref_person_id: string | null;
  santex_lead_ref_person_id: string | null;
};
