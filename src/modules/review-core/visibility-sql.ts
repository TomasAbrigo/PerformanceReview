import { type SQL, sql } from "drizzle-orm";

/**
 * SQL twin of `canRead` (visibility.ts) for one case the aggregate readers
 * need: whether the SNAPSHOT MANAGER of participant `cp` may read a
 * submitted review of relationship `r` of cycle `c` (aliases of the
 * surrounding query). A manager review: always. A self review: unless the
 * cycle is double blind (components.doubleBlind, missing = on) and the
 * participant's manager review is not submitted yet — what /assessments
 * shows as "Reservada". A db test keeps it in agreement with `canRead`.
 */
export function managerMayReadSql(r = "r", cp = "cp", c = "c"): SQL {
  const R = sql.raw(r);
  const CP = sql.raw(cp);
  const C = sql.raw(c);
  return sql`(${R}.relationship <> 'self'
    or coalesce((${C}.components->>'doubleBlind')::boolean, true) = false
    or exists (
      select 1 from review_request mr
      where mr.participant_id = ${CP}.id and mr.relationship = 'manager'
        and mr.status = 'submitted' and mr.deleted_at is null))`;
}
