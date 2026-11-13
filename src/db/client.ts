import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | undefined;
let instance: Database | undefined;

/** Creates the connection on first use, so importing this module is free. */
export function getDb(): Database {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // With a Supabase transaction pooler (port 6543) add `{ prepare: false }`.
    client = postgres(url);
    instance = drizzle(client, { schema });
  }
  return instance;
}

/** Closes the connection (scripts and tests); `db` reconnects lazily if used again. */
export async function closeDb(): Promise<void> {
  const current = client;
  client = undefined;
  instance = undefined;
  await current?.end();
}

/** Lazy `db`: the connection is only opened on first property access. */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const target = getDb();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
