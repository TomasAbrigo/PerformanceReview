/**
 * pnpm db:seed [--size small|demo] [--reset] [--no-reports] [--no-analysis]
 *
 * Fills the local database from the generated Bamboo fixtures
 * (fixtures/bamboo/<size>) through the registered ingest pipelines, the same
 * ones (and the same summary table) as `pnpm ingest --all --source fixture`.
 * Then (unless --no-reports) it imports the report exports of
 * fixtures/bamboo-reports/<size> through the upload path (semi-annual cycles,
 * answers, completion) and (unless --no-analysis) labels the open-text answers
 * with the mock provider. Prints counts and elapsed time, never names.
 * Idempotent: running it again reports everything unchanged. --reset empties
 * the domain tables first (local database only, refused while a run is in
 * progress). Exit code: 0 all runs succeeded, 1 a run (or the reset) failed,
 * 2 bad arguments or configuration.
 */
import { errorMessage } from "../src/lib/log";
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
import { seedInsights } from "../src/modules/ingest/seed-reports";

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
    console.error(errorMessage(err));
    console.error(SEED_USAGE);
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set (see .env.example)");
    return 2;
  }

  const started = performance.now();
  if (args.reset) {
    try {
      assertLocalDatabase(process.env.DATABASE_URL);
    } catch (err) {
      console.error(errorMessage(err));
      return 2;
    }
    try {
      await resetDomainTables(db);
    } catch (err) {
      console.error(errorMessage(err));
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
  let failed = outcomes.some((o) => o.status === "error");
  if (args.reports && !failed) {
    try {
      const insights = await seedInsights({
        size: args.size,
        db,
        analysis: args.analysis,
        lock: (key, fn) => withAdvisoryLock(db, key, fn),
      });
      for (const r of insights.reports) {
        const c = r.counts;
        console.log(
          c
            ? `${r.profile}: ${r.status}, read ${c.read}, inserted ${c.inserted}, updated ${c.updated}, unchanged ${c.unchanged}, rejected ${c.rejected}${r.runId ? ` (run ${r.runId})` : ""}`
            : `${r.profile}: ${r.status}${r.runId ? ` (run ${r.runId})` : ""}`,
        );
        if (r.status === "needs_decision") {
          console.error(
            `${r.profile}: rows wait for a cycle; resolve them in /es/imports/history/${r.runId}`,
          );
        } else if (r.status === "error") {
          console.error(`${r.profile}: ${r.error}`);
        }
      }
      if (!insights.ok) failed = true;
      console.log(
        `cycles: ${await count("review_cycle")}, participants: ${await count("cycle_participant")}, answers: ${await count("answer")}, completion rows: ${await count("assessment_progress")}`,
      );
      const a = insights.analysis;
      if (a) {
        console.log(
          `analysis mock: ${a.total} texts, ${a.analyzed} analyzed, ${a.cached} cached, ${a.corrected} corrected (run ${a.runId})`,
        );
      }
    } catch (err) {
      console.error(`reports/analysis: ${errorMessage(err)}`);
      failed = true;
    }
  }
  console.log(
    `Seed finished in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );

  const waiting = outcomes.find((o) => o.entity === "employee")?.counts?.issues;
  if (waiting) {
    console.log(
      `${waiting} records wait for a person in the identity queue (rehires): /es/imports/identity`,
    );
  }
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(errorMessage(err));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
