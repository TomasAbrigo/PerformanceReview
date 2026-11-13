import postgres from "postgres";

/**
 * Runs `fn` while holding a Postgres advisory lock named `key`, waiting if
 * another process holds it. Two overlapping runs of the same entity (a slow
 * cron job and the next one, or two people at once) would race on the same
 * rows; this makes them take turns. The lock lives on its own connection and
 * is released when that connection closes, even if the process dies.
 */
export async function withAdvisoryLock<T>(
  key: string,
  fn: () => Promise<T>,
  url = process.env.DATABASE_URL,
): Promise<T> {
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(hashtextextended(${key}, 0))`;
    return await fn();
  } finally {
    await sql.end();
  }
}
