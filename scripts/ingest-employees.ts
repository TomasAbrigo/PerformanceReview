/**
 * pnpm ingest:employees --source fixture|bamboo [--dir path] [--entity employee|job_history|goal]
 * job_history (jobInfo + employmentStatus tables) needs employees ingested first.
 * goal (goals of the active employees) needs employees ingested first;
 * `pnpm ingest:goals` is the same with --entity goal.
 * --since <ISO> (bamboo, job_history only): only employees whose tables changed.
 * bamboo needs BAMBOO_COMPANY_DOMAIN and BAMBOO_API_KEY.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { closeDb, db } from "../src/db/client";
import { createBambooClient } from "../src/modules/bamboo-client";
import { runGoalIngest } from "../src/modules/goals";
import {
  BambooApiAdapter,
  FixtureAdapter,
  runIngest,
  type Entity,
  type SourceAdapter,
} from "../src/modules/ingest";

const ENTITIES: readonly Entity[] = ["employee", "job_history", "goal"];

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the real environment
}

const DEFAULT_DIR = "src/modules/bamboo-client/__fixtures__";

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: "string", default: "fixture" },
      dir: { type: "string", default: DEFAULT_DIR },
      entity: { type: "string", default: "employee" },
      since: { type: "string" },
    },
  });
  const entity = values.entity as Entity;
  if (!ENTITIES.includes(entity)) {
    throw new Error(`--entity must be one of ${ENTITIES.join(", ")}`);
  }

  if (values.since && entity !== "job_history") {
    throw new Error("--since is only supported with --entity job_history");
  }

  let adapter: SourceAdapter;
  if (values.source === "fixture") {
    adapter = new FixtureAdapter(path.resolve(values.dir));
  } else if (values.source === "bamboo") {
    const companyDomain = process.env.BAMBOO_COMPANY_DOMAIN;
    const apiKey = process.env.BAMBOO_API_KEY;
    if (!companyDomain || !apiKey) {
      throw new Error("Set BAMBOO_COMPANY_DOMAIN and BAMBOO_API_KEY");
    }
    adapter = new BambooApiAdapter(
      createBambooClient({ companyDomain, apiKey }),
    );
  } else {
    throw new Error(
      `--source must be fixture or bamboo (got ${values.source})`,
    );
  }

  const params = {
    source: values.source,
    dir: values.dir,
    since: values.since,
  };
  const { runId, counts } =
    entity === "goal"
      ? await runGoalIngest({ adapter, db, params })
      : await runIngest({
          adapter,
          entity,
          db,
          params,
          extract: { since: values.since },
        });
  console.log(`ingest_run ${runId}`);
  console.log(JSON.stringify(counts));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
