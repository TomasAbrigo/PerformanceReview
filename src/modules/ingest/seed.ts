import path from "node:path";
import { parseArgs } from "node:util";
import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { ingestRun, type IngestCounts } from "@/db/schema";
import { REGISTRY, type AdapterContext } from "./registry";

/** The sizes of the generated fixtures (`fixtures/bamboo/<size>`). */
export const SEED_SIZES = ["small", "demo"] as const;
export type SeedSize = (typeof SEED_SIZES)[number];

/** Where the generated Bamboo API responses of a size live (from the repo root). */
export const seedFixturesDir = (size: SeedSize) =>
  path.join("fixtures", "bamboo", size);

/**
 * What `--reset` empties: everything that ingestion fills (and what hangs
 * from it), children first. Listed by hand on purpose, and checked against
 * the real tables by a test: a new table must be put in one list or the other.
 */
export const RESET_TABLES = [
  "goal_share",
  "goal_comment",
  "goal_milestone",
  "goal",
  "employee_status_history",
  "employee_job_history",
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
 * Empties the domain tables (TRUNCATE: the tables stay). Without CASCADE on
 * purpose: if a table not listed here points at one that is, Postgres refuses
 * instead of silently emptying it.
 */
export async function resetDomainTables(db: DbOrTx): Promise<void> {
  await db.execute(
    sql.raw(`TRUNCATE TABLE ${RESET_TABLES.map((t) => `"${t}"`).join(", ")}`),
  );
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** `--reset` is for the local stack only: refuse any other database. */
export function assertLocalDatabase(databaseUrl: string | undefined): void {
  let host: string | null = null;
  try {
    host = databaseUrl ? new URL(databaseUrl).hostname : null;
  } catch {
    // not a URL: refused below
  }
  if (!host || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to reset a database that is not local (DATABASE_URL host: ${host ?? "unset or invalid"})`,
    );
  }
}

export type SeedRun = {
  entity: string;
  runId: string;
  counts: IngestCounts;
  /** Entries in the run's `rejects`: rejected records plus unresolved references. */
  issues: number;
};

/**
 * Fills the database from the generated Bamboo fixtures of `size`, running
 * the registered ingest pipelines in registry order (employee, then what
 * resolves people through it), as `pnpm ingest --all --source fixture
 * --dir fixtures/bamboo/<size>` would. Idempotent: on a seeded database every
 * record comes back `unchanged`. Stops at the first pipeline that fails.
 *
 * Does not empty anything: `resetDomainTables` first for a clean start.
 */
export async function seedFromFixtures({
  size,
  db,
  dir = seedFixturesDir(size),
}: {
  size: SeedSize;
  db: DbOrTx;
  /** Overrides where the responses are read from (default: the committed fixtures). */
  dir?: string;
}): Promise<SeedRun[]> {
  const ctx: AdapterContext = {
    dir: path.resolve(dir),
    bambooClient: () => {
      throw new Error("The seed reads fixtures, it never calls Bamboo");
    },
  };
  const params = { source: "fixture", dir, seed: size };

  const runs: SeedRun[] = [];
  for (const [entity, entry] of REGISTRY) {
    const { runId, counts } = await entry.run({
      adapter: entry.adapters.fixture(ctx),
      db,
      params,
    });
    const [run] = await db
      .select({ rejects: ingestRun.rejects })
      .from(ingestRun)
      .where(eq(ingestRun.id, runId));
    runs.push({ entity, runId, counts, issues: run?.rejects?.length ?? 0 });
  }
  return runs;
}

/** The table `pnpm db:seed` prints, one row per pipeline. */
export function formatSeedSummary(runs: SeedRun[]): string {
  const header = [
    "entity",
    "read",
    "inserted",
    "updated",
    "unchanged",
    "rejected",
    "issues",
    "run",
  ];
  const rows = runs.map((r) => [
    r.entity,
    ...(["read", "inserted", "updated", "unchanged", "rejected"] as const).map(
      (k) => String(r.counts[k]),
    ),
    String(r.issues),
    r.runId,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  return [header, ...rows]
    .map((r) =>
      r
        .map((cell, i) => cell.padEnd(widths[i]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
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
