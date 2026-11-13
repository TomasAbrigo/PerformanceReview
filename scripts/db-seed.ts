/**
 * pnpm db:seed [--size small|demo] [--reset]
 *
 * Fills the local database from the generated Bamboo fixtures
 * (fixtures/bamboo/<size>) through the registered ingest pipelines, and prints
 * what each one did. Idempotent: running it again reports everything
 * unchanged. --reset empties the domain tables first (local database only).
 */
import { sql } from "drizzle-orm";
import { closeDb, db } from "../src/db/client";
import {
  assertLocalDatabase,
  formatSeedSummary,
  parseSeedArgs,
  resetDomainTables,
  seedFixturesDir,
  seedFromFixtures,
  SEED_USAGE,
} from "../src/modules/ingest/seed";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the real environment
}

async function count(table: string): Promise<number> {
  const rows = await db.execute(
    sql.raw(`select count(*)::int as n from "${table}"`),
  );
  return (rows as unknown as { n: number }[])[0].n;
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseSeedArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    console.error(SEED_USAGE);
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set (see .env.example)");
    return 2;
  }

  if (args.reset) {
    try {
      assertLocalDatabase(process.env.DATABASE_URL);
    } catch (err) {
      console.error((err as Error).message);
      return 2;
    }
    await resetDomainTables(db);
    console.log("Domain tables emptied.");
  }

  console.log(`Seeding from ${seedFixturesDir(args.size)}`);
  const runs = await seedFromFixtures({ size: args.size, db });
  console.log(formatSeedSummary(runs));
  console.log(
    `\nperson: ${await count("person")}, job history rows: ${await count("employee_job_history")}, goals: ${await count("goal")}`,
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
