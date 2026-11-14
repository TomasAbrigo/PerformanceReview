import postgres from "postgres";
import { assertLocalDatabase } from "../src/db/local";

export { e2eDatabaseUrl } from "../src/db/local";

/** Creates the e2e database when it does not exist yet (always a local one). */
export async function ensureDatabase(databaseUrl: string): Promise<void> {
  assertLocalDatabase(databaseUrl);
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe e2e database name "${name}" (letters, digits, _)`);
  }
  // CREATE DATABASE cannot run inside the database being created: go through
  // the server's own `postgres` database.
  url.pathname = "/postgres";
  const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    const [found] =
      await sql`select 1 from pg_database where datname = ${name}`;
    if (!found) await sql.unsafe(`create database "${name}"`);
  } finally {
    await sql.end();
  }
}
