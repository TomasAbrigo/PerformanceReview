import { sql, type SQL } from "drizzle-orm";
import { jobValidOn } from "@/lib/sql";
import { decodeCursor } from "../pagination";

/** A person as other objects point at it: internal id plus its Bamboo identity. */
export type PersonRef = {
  id: string;
  /** source_system and value of the person's open bamboo_id identity. */
  sourceSystem: string | null;
  sourceId: string | null;
  displayName: string;
};

export function personRef(
  id: string | null,
  sourceSystem: string | null,
  sourceId: string | null,
  displayName: string | null,
): PersonRef | null {
  return id === null || displayName === null
    ? null
    : { id, sourceSystem, sourceId, displayName };
}

/**
 * A timestamptz as UTC ISO text with microseconds. Used for every timestamp
 * of the API and for keyset cursors: a JS Date would truncate to
 * milliseconds and rows inside that millisecond could be skipped or repeated.
 */
export const iso = (column: string): SQL =>
  sql.raw(
    `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  );

/** CTEs: `bamboo_identity(person_id, source_system, value)` and `employee_number(person_id, value)`, one open row per person. */
export const identityCtes = sql`
  bamboo_identity as (
    select distinct on (i.person_id) i.person_id, i.source_system, i.value
    from source_identity i
    where i.kind = 'bamboo_id' and i.valid_to is null
    order by i.person_id, i.valid_from desc, i.id
  ),
  employee_number as (
    select distinct on (i.person_id) i.person_id, i.value
    from source_identity i
    where i.kind = 'employee_number' and i.valid_to is null
    order by i.person_id, i.valid_from desc, i.id
  )
`;

/**
 * Keyset condition for rows ordered by (timestamp, id): everything after (or,
 * descending, before) the cursor position. `true` on the first page.
 */
export function afterTsId(
  tsColumn: string,
  idColumn: string,
  cursor: string | null | undefined,
  direction: "asc" | "desc" = "asc",
): SQL {
  const position = decodeCursor(cursor, "ts_id");
  if (!position) return sql`true`;
  const op = sql.raw(direction === "asc" ? ">" : "<");
  return sql`(${sql.raw(tsColumn)}, ${sql.raw(idColumn)}) ${op} (${position[0]}::timestamptz, ${position[1]}::uuid)`;
}

/** Keyset condition for rows ordered by id. */
export function afterId(
  idColumn: string,
  cursor: string | null | undefined,
): SQL {
  const position = decodeCursor(cursor, "id");
  return position
    ? sql`${sql.raw(idColumn)} > ${position[0]}::uuid`
    : sql`true`;
}

export const and = (conditions: (SQL | undefined)[]): SQL =>
  sql.join(
    conditions.filter((c): c is SQL => c !== undefined),
    sql` and `,
  );

/** `source: { system, id }` of a row, or null when it has no source id (native rows). */
export const sourceOf = (
  system: string | null,
  id: string | null,
): { system: string; id: string } | null =>
  system && id !== null ? { system, id } : null;

/** `left join lateral` of the job row of `personColumn` valid today (the latest if several), as `alias`. */
export const currentJobJoin = (personColumn: string, alias = "j"): SQL =>
  sql`left join lateral (
    select h.* from employee_job_history h
    where h.person_id = ${sql.raw(personColumn)} and ${jobValidOn("h")}
    order by h.valid_from desc, h.id
    limit 1
  ) ${sql.raw(alias)} on true`;
