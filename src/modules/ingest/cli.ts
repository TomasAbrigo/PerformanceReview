import path from "node:path";
import { parseArgs } from "node:util";
import { closeDb, db, type DbOrTx } from "@/db/client";
import type { IngestCounts } from "@/db/schema";
import { withAdvisoryLock } from "./lock";
import {
  bambooClientFromEnv,
  DEFAULT_FIXTURES_DIR,
  REGISTRY,
  type EntityEntry,
} from "./registry";
import { IngestRunError } from "./run-ingest";
import { getSyncState, type SyncKey } from "./sync-state";

export { DEFAULT_FIXTURES_DIR };

export const CLI_SOURCES = ["fixture", "bamboo"] as const;
export type CliSource = (typeof CLI_SOURCES)[number];

/** Bad command line: printed with the usage text, exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type IngestCliArgs = {
  /** Registered entity names, in the order they will run. */
  entities: string[];
  source: CliSource;
  dir: string;
  /** ISO instant, or "last" to continue from the stored watermark. */
  since: string | undefined;
};

type Registry = ReadonlyMap<string, EntityEntry>;
type Env = Record<string, string | undefined>;

export function usage(registry: Registry): string {
  return [
    "Usage:",
    "  pnpm ingest <entity> --source fixture|bamboo [--dir <path>] [--since <iso>|last]",
    "  pnpm ingest --all --source fixture|bamboo [--dir <path>] [--since <iso>|last]",
    "",
    `Entities: ${[...registry.keys()].join(", ")}`,
    "  --source  fixture reads saved Bamboo responses (--dir, default " +
      `${DEFAULT_FIXTURES_DIR});`,
    "            bamboo calls the API (BAMBOO_COMPANY_DOMAIN and BAMBOO_API_KEY)",
    "  --since   only what changed since that instant; `last` uses the stored",
    "            watermark. Without it the extraction is full.",
    "  --all     every entity, in registry order; keeps going after a failure",
    "",
    "Exit code: 0 all runs succeeded, 1 a run failed, 2 bad arguments.",
  ].join("\n");
}

export function parseIngestArgs(
  argv: string[],
  registry: Registry,
): IngestCliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        source: { type: "string" },
        dir: { type: "string", default: DEFAULT_FIXTURES_DIR },
        since: { type: "string" },
        all: { type: "boolean", default: false },
      },
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;

  if (values.all && positionals.length > 0) {
    throw new UsageError("Pass either an entity or --all, not both");
  }
  if (!values.all && positionals.length === 0) {
    throw new UsageError("Missing entity (or --all)");
  }
  if (positionals.length > 1) {
    throw new UsageError(
      `Expected one entity, got ${positionals.length}: ${positionals.join(", ")}`,
    );
  }
  const entities = values.all ? [...registry.keys()] : positionals;
  for (const name of entities) {
    if (!registry.has(name)) {
      throw new UsageError(
        `Unknown entity "${name}". Registered: ${[...registry.keys()].join(", ")}`,
      );
    }
  }

  const source = values.source;
  if (!source) {
    throw new UsageError("--source is required (fixture or bamboo)");
  }
  if (!(CLI_SOURCES as readonly string[]).includes(source)) {
    throw new UsageError(`--source must be fixture or bamboo (got ${source})`);
  }

  let since: string | undefined;
  if (values.since === "last") {
    since = "last";
  } else if (values.since !== undefined) {
    const at = new Date(values.since);
    if (Number.isNaN(at.getTime())) {
      throw new UsageError(
        `--since must be an ISO date/time or "last" (got ${values.since})`,
      );
    }
    since = at.toISOString();
  }

  return { entities, source: source as CliSource, dir: values.dir, since };
}

export type IngestCliDeps = {
  db: DbOrTx;
  registry?: Registry;
  env?: Env;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Runs `fn` exclusively per key. Defaults to no locking. */
  lock?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  /** The stored watermark for `--since last`. Defaults to `sync_state`. */
  readWatermark?: (key: SyncKey) => Promise<string | null>;
};

type Outcome = {
  entity: string;
  adapter: string;
  status: "succeeded" | "error";
  counts?: Partial<IngestCounts>;
  runId?: string;
  durationMs: number;
  error?: string;
};

const COUNT_COLUMNS = [
  "read",
  "inserted",
  "updated",
  "unchanged",
  "deleted",
  "rejected",
] as const;

export function formatSummary(outcomes: Outcome[]): string {
  const header = [
    "entity",
    "adapter",
    "status",
    ...COUNT_COLUMNS,
    "duration",
    "run",
  ];
  const rows = outcomes.map((o) => [
    o.entity,
    o.adapter,
    o.status,
    ...COUNT_COLUMNS.map((c) => String(o.counts?.[c] ?? "-")),
    `${(o.durationMs / 1000).toFixed(1)}s`,
    o.runId ?? "-",
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

/**
 * Runs the requested entities and prints a summary table. Returns the exit
 * code: 0 when every run succeeded, 1 when any failed, 2 on bad arguments.
 * With `--all` a failed entity does not stop the following ones.
 */
export async function runIngestCli(
  argv: string[],
  deps: IngestCliDeps,
): Promise<number> {
  const registry = deps.registry ?? REGISTRY;
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? console.log;
  const stderr = deps.stderr ?? console.error;
  const lock = deps.lock ?? ((_key, fn) => fn());
  const readWatermark =
    deps.readWatermark ??
    (async (key: SyncKey) =>
      (await getSyncState(deps.db, key))?.watermark ?? null);

  if (argv.includes("--help") || argv.includes("-h")) {
    stdout(usage(registry));
    return 0;
  }

  let args: IngestCliArgs;
  try {
    args = parseIngestArgs(argv, registry);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr(err.message);
    stderr("");
    stderr(usage(registry));
    return 2;
  }

  const ctx = {
    dir: path.resolve(args.dir),
    bambooClient: () => bambooClientFromEnv(env),
  };
  const params =
    args.source === "fixture"
      ? { source: args.source, dir: args.dir }
      : { source: args.source };

  const outcomes: Outcome[] = [];
  for (const entity of args.entities) {
    const entry = registry.get(entity)!;
    const started = Date.now();
    try {
      const adapter = entry.adapters[args.source](ctx);
      const result = await lock(`ingest:${entity}`, async () => {
        // Read after taking the lock: a run ahead of us may have advanced it.
        let since = args.since;
        if (since === "last") {
          since =
            (await readWatermark({ sourceSystem: adapter.source, entity })) ??
            undefined;
        }
        return entry.run({ adapter, db: deps.db, params, since });
      });
      outcomes.push({
        entity,
        adapter: adapter.name,
        status: "succeeded",
        counts: result.counts,
        runId: result.runId,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      const failed = err instanceof IngestRunError ? err : undefined;
      outcomes.push({
        entity,
        adapter: args.source,
        status: "error",
        counts: failed?.counts,
        runId: failed?.runId,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  stdout(formatSummary(outcomes));
  for (const o of outcomes) {
    if (o.status === "error") {
      stderr(`${o.entity}: ${o.error}${o.runId ? ` (run ${o.runId})` : ""}`);
    }
  }
  return outcomes.some((o) => o.status === "error") ? 1 : 0;
}

/** Entry point of the scripts: load env, run, close the pool, set the exit code. */
export async function cliMain(argv: string[]): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // rely on the real environment
  }
  try {
    process.exitCode = await runIngestCli(argv, {
      db,
      env: process.env,
      lock: withAdvisoryLock,
    });
  } finally {
    await closeDb();
  }
}
