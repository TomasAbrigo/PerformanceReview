import type { DbOrTx } from "@/db/client";
import { createBambooClient, type BambooClient } from "@/modules/bamboo-client";
import { BambooApiAdapter } from "./bamboo-api-adapter";
import { FixtureAdapter } from "./fixture-adapter";
import { runIngest, type RunIngestResult } from "./run-ingest";
import type { SourceAdapter } from "./types";

/** Where the saved Bamboo API responses used by the `fixture` source live. */
export const DEFAULT_FIXTURES_DIR = "src/modules/bamboo-client/__fixtures__";

/** What an entity needs to build its adapters, from the CLI's options. */
export type AdapterContext = {
  /** Directory of saved responses for the `fixture` source. */
  dir: string;
  /** Builds the Bamboo client from the environment; throws if it is not configured. */
  bambooClient: () => BambooClient;
};

export type EntityRunInput = {
  adapter: SourceAdapter;
  db: DbOrTx;
  /** Stored on the ingest_run (source, dir, ...). */
  params: Record<string, unknown>;
  /** Incremental lower bound (a watermark); undefined means a full extraction. */
  since?: string;
};

export type EntityEntry = {
  adapters: {
    fixture: (ctx: AdapterContext) => SourceAdapter;
    bamboo: (ctx: AdapterContext) => SourceAdapter;
  };
  /**
   * Runs the whole pipeline for the entity. It must record an `ingest_run`
   * and, on success only, advance `sync_state` (`runIngest` already does both).
   */
  run: (input: EntityRunInput) => Promise<RunIngestResult>;
};

export function bambooClientFromEnv(
  env: Record<string, string | undefined>,
): BambooClient {
  const companyDomain = env.BAMBOO_COMPANY_DOMAIN;
  const apiKey = env.BAMBOO_API_KEY;
  if (!companyDomain || !apiKey) {
    throw new Error("Set BAMBOO_COMPANY_DOMAIN and BAMBOO_API_KEY");
  }
  return createBambooClient({ companyDomain, apiKey });
}

/**
 * Every entity `pnpm ingest` can run, by name. `--all` runs them in insertion
 * order, so register an entity after the ones it depends on. To add an entity
 * (job_history, goal, ...) add one entry here; the CLI, the run log and
 * `sync_state` pick it up without further changes.
 */
export const REGISTRY = new Map<string, EntityEntry>([
  [
    "employee",
    {
      adapters: {
        fixture: ({ dir }) => new FixtureAdapter(dir),
        bamboo: ({ bambooClient }) => new BambooApiAdapter(bambooClient()),
      },
      run: ({ adapter, db, params, since }) =>
        runIngest({ adapter, entity: "employee", db, params, since }),
    },
  ],
]);
