import path from "node:path";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { runEntities, type Outcome } from "./cli";
import { ingestLockKey } from "./lock";
import { REGISTRY, type AdapterContext, type EntityEntry } from "./registry";
import type { SourceAdapter } from "./types";

/** The sizes of the generated fixtures (`fixtures/bamboo/<size>`). */
export const SEED_SIZES = ["small", "demo"] as const;
export type SeedSize = (typeof SEED_SIZES)[number];

/** Where the generated Bamboo API responses of a size live (from the repo root). */
export const seedFixturesDir = (size: SeedSize) =>
  path.join("fixtures", "bamboo", size);

/**
 * What `--reset` empties: everything that ingestion fills and what hangs from
 * it, children first. The review cycles go too: they point at people and job
 * history rows, which are rebuilt with new ids. Listed by hand on purpose, and
 * checked against the real tables by a test: a new table must be put in one
 * list or the other.
 */
export const RESET_TABLES = [
  "answer",
  "review_audit",
  "review_request",
  "participant_goal_snapshot",
  "cycle_goal_link",
  "goal_share",
  "goal_comment",
  "goal_milestone",
  "goal",
  "cycle_participant",
  "cycle_transition",
  "question_revision",
  "review_cycle",
  "employee_status_history",
  "employee_job_history",
  "identity_match_issue",
  "source_identity",
  "employment",
  "person",
  "sync_state",
  "raw_record",
  "ingest_run",
] as const;

/** Tables the seed leaves alone: settings the app owns, not data from Bamboo. */
export const KEPT_TABLES = [
  "rating_scale",
  "rating_scale_option",
  "review_template",
  "template_section",
  "question",
] as const;

/**
 * Empties the domain tables (TRUNCATE: the tables stay). Refuses while an
 * ingest run is in progress: it first tries the advisory lock of every
 * registered entity, the one `pnpm ingest` and the seed hold for the length of
 * a run, so emptying the tables under a live run is not possible. (The lock,
 * not the `running` status of `ingest_run`: a process that died leaves a
 * `running` row behind forever, a lock dies with it.)
 *
 * Without CASCADE on purpose: if a table not listed here points at one that
 * is, Postgres refuses instead of silently emptying it.
 */
export async function resetDomainTables(
  db: DbOrTx,
  registry: ReadonlyMap<string, unknown> = REGISTRY,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const entity of registry.keys()) {
      const rows = await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${ingestLockKey(entity)}, 0)) as locked`,
      );
      if (!(rows as unknown as { locked: boolean }[])[0].locked) {
        throw new Error(
          `An ingest run of "${entity}" is in progress: wait for it before resetting`,
        );
      }
    }
    await tx.execute(
      sql.raw(`TRUNCATE TABLE ${RESET_TABLES.map((t) => `"${t}"`).join(", ")}`),
    );
  });
}

/**
 * Fills the database from the generated Bamboo fixtures of `size`, running
 * the registered ingest pipelines in registry order (employee, then what
 * resolves people through it), exactly as `pnpm ingest --all --source fixture
 * --dir fixtures/bamboo/<size>` does: the same loop (`runEntities`), each
 * entity under its lock. A pipeline that fails does not stop the next one; its
 * outcome is an `error` with the id of the run that failed.
 *
 * Idempotent: on a seeded database nothing is inserted or updated and what was
 * applied comes back `unchanged`. What the identity module holds for a human
 * (a rehire: known legajo and email under a new Bamboo id) is held again, so
 * it stays out of the people, the job history and the goals until someone
 * resolves it in /imports/identity.
 *
 * Does not empty anything: `resetDomainTables` first for a clean start.
 */
export async function seedFromFixtures({
  size,
  db,
  dir = seedFixturesDir(size),
  registry = REGISTRY,
  lock = (_key, fn) => fn(),
}: {
  size: SeedSize;
  db: DbOrTx;
  /** Overrides where the responses are read from (default: the committed fixtures). */
  dir?: string;
  registry?: ReadonlyMap<string, EntityEntry>;
  /** Runs `fn` exclusively per key; the script passes the CLI's advisory lock. */
  lock?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
}): Promise<Outcome[]> {
  const ctx: AdapterContext = {
    dir: path.resolve(dir),
    bambooClient: () => {
      throw new Error("The seed reads fixtures, it never calls Bamboo");
    },
  };
  const adapters = new Map<string, SourceAdapter>(
    [...registry].map(([entity, entry]) => [
      entity,
      entry.adapters.fixture(ctx),
    ]),
  );
  return runEntities({
    registry,
    db,
    entities: [...registry.keys()],
    adapters,
    params: { source: "fixture", dir },
    lock,
    readWatermark: async () => null,
  });
}

export const SEED_USAGE = `Usage: pnpm db:seed [--size small|demo] [--reset]
  --size   fixtures/bamboo/<size>: small (40 employees) or demo (400); default small
  --reset  empty the domain tables first (local database only)`;

export type SeedArgs = { size: SeedSize; reset: boolean };

/** Throws a plain Error with the reason when the arguments are wrong. */
export function parseSeedArgs(argv: string[]): SeedArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      size: { type: "string", default: "small" },
      reset: { type: "boolean", default: false },
    },
  });
  if (!(SEED_SIZES as readonly string[]).includes(values.size)) {
    throw new Error(
      `--size must be ${SEED_SIZES.join(" or ")} (got ${values.size})`,
    );
  }
  return { size: values.size as SeedSize, reset: values.reset };
}
