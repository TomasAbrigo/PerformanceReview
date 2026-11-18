import { sql, type SQL } from "drizzle-orm";

/** The rows of a raw `db.execute` result, typed (postgres-js hands back an array-like). */
export const rowsOf = <T>(result: unknown): T[] => [...(result as T[])];

/**
 * Predicate: the job-history row aliased `alias` (not deleted) is valid on
 * `date` (YYYY-MM-DD) or, without one, today in the database. Intervals are
 * [valid_from, valid_to), valid_to null = still open.
 */
export function jobValidOn(alias: string, date?: string): SQL {
  const on = date === undefined ? sql`current_date` : sql`${date}::date`;
  const a = sql.raw(alias);
  return sql`${a}.deleted_at is null and ${a}.valid_from <= ${on} and (${a}.valid_to is null or ${a}.valid_to > ${on})`;
}

/** The conditions joined with `and` (an empty list is `true`). */
export const allOf = (conditions: SQL[]): SQL =>
  conditions.length ? sql.join(conditions, sql` and `) : sql`true`;

/** A `like`/`ilike` pattern that matches `text` anywhere, searched as typed (`%`, `_` and `\` are not wildcards). */
export const containsPattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, "\\$&")}%`;
