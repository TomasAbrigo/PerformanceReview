/**
 * pnpm db:seed [--size small|demo] [--reset]
 *
 * Fills the local database from the generated Bamboo fixtures
 * (fixtures/bamboo/<size>) through the registered ingest pipelines, the same
 * ones (and the same summary table) as `pnpm ingest --all --source fixture`.
 * Idempotent: running it again reports everything unchanged. --reset empties
 * the domain tables first (local database only, refused while a run is in
 * progress). Exit code: 0 all runs succeeded, 1 a run (or the reset) failed,
 * 2 bad arguments or configuration.
 */
import { sql } from "drizzle-orm";
import { closeDb, db } from "../src/db/client";
import { assertLocalDatabase } from "../src/db/local";
import { formatSummary } from "../src/modules/ingest/cli";
import { withAdvisoryLock } from "../src/modules/ingest/lock";
import {
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
    try {
      await resetDomainTables(db);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      return 1;
    }
    console.log("Domain tables emptied.");
  }

  console.log(`Seeding from ${seedFixturesDir(args.size)}`);
  const outcomes = await seedFromFixtures({
    size: args.size,
    db,
    lock: (key, fn) => withAdvisoryLock(db, key, fn),
  });
  console.log(formatSummary(outcomes));
  for (const o of outcomes) {
    if (o.status === "error") {
      console.error(
        `${o.entity}: ${o.error}${o.runId ? ` (run ${o.runId})` : ""}`,
      );
    }
  }

  console.log(
    `\nperson: ${await count("person")}, job history rows: ${await count("employee_job_history")}, goals: ${await count("goal")}`,
  );
  const waiting = outcomes.find((o) => o.entity === "employee")?.counts?.issues;
  if (waiting) {
    console.log(
      `${waiting} records wait for a person in the identity queue (rehires): /es/imports/identity`,
    );
  }
  return outcomes.some((o) => o.status === "error") ? 1 : 0;
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
