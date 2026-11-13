import type { DbOrTx } from "@/db/client";
import { createBambooClient, type BambooClient } from "@/modules/bamboo-client";
import { runGoalIngest } from "@/modules/goals";
import { BambooApiAdapter } from "./bamboo-api-adapter";
import { FixtureAdapter } from "./fixture-adapter";
import { entityHandlers } from "./handlers";
import { runIngest, type RunIngestResult } from "./run-ingest";
import type { Entity, SourceAdapter } from "./types";

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
  /** employee: what to do with a record that matches nobody (default: create). */
  unmatched?: "create" | "queue";
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

const adapters: EntityEntry["adapters"] = {
  fixture: ({ dir }) => new FixtureAdapter(dir),
  bamboo: ({ bambooClient }) => new BambooApiAdapter(bambooClient()),
};

/** The entities that `runIngest` knows (an entry in `entityHandlers`). */
const viaRunIngest = (entity: Entity): EntityEntry => ({
  adapters,
  run: ({ adapter, db, params, since, unmatched }) =>
    runIngest({
      adapter,
      entity,
      db,
      params,
      extract: { since },
      ...(unmatched ? { unmatched } : {}),
    }),
});

/**
 * Every entity `pnpm ingest` can run, by name, in `--all` order: employee
 * first, then what resolves people through it (job_history, goal).
 *
 * - One per handler in `entityHandlers` (handlers.ts), via `runIngest`: to add
 *   an entity that `runIngest` can stage, add its handler there and nothing
 *   else; the CLI, the run log and `sync_state` pick it up.
 * - Entities with their own pipeline (goal: it reads the active employees and
 *   fetches comments lazily) are registered with a custom `run`. It must record
 *   an `ingest_run` (with its `entity`), advance `sync_state` in the
 *   transaction that marks it succeeded, and throw an `IngestRunError` when the
 *   run ends in error, as `runGoalIngest` does.
 */
export const REGISTRY = new Map<string, EntityEntry>([
  ...(Object.keys(entityHandlers) as Entity[]).map(
    (entity) => [entity, viaRunIngest(entity)] as const,
  ),
  [
    "goal",
    {
      adapters,
      // Always a full read: goals have no incremental extraction (`since` is
      // ignored); what changed is found by comparing hashes.
      run: ({ adapter, db, params }) => runGoalIngest({ adapter, db, params }),
    },
  ],
]);
