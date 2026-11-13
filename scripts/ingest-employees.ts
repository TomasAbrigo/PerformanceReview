/**
 * pnpm ingest:employees --source fixture|bamboo [--dir path]
 * bamboo needs BAMBOO_COMPANY_DOMAIN and BAMBOO_API_KEY.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { closeDb, db } from "../src/db/client";
import { createBambooClient } from "../src/modules/bamboo-client";
import {
  BambooApiAdapter,
  FixtureAdapter,
  runIngest,
  type SourceAdapter,
} from "../src/modules/ingest";

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
    },
  });

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

  const { runId, counts } = await runIngest({
    adapter,
    entity: "employee",
    db,
    params: { source: values.source, dir: values.dir },
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
