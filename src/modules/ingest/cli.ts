import path from "node:path";
import { parseArgs } from "node:util";
import { closeDb, db, type DbOrTx } from "@/db/client";
import { INGEST_COUNT_KEYS, type IngestCounts } from "@/db/schema";
import { withAdvisoryLock } from "./lock";
import {
  bambooClientFromEnv,
  DEFAULT_FIXTURES_DIR,
  REGISTRY,
  type EntityEntry,
} from "./registry";
import { IngestRunError } from "./run-ingest";
import type { SourceAdapter } from "./types";
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
    "  --since   only what changed since that instant (ISO 8601: 2026-11-01 or",
    "            2026-11-01T10:00:00Z, with an offset when a time is given);",
    "            `last` uses the stored watermark. Without it the extraction is full.",
    "  --all     every entity, in registry order; keeps going after a failure",
    "",
    "Exit code: 0 all runs succeeded, 1 a run failed, 2 bad arguments or",
    "configuration (missing BAMBOO_* / DATABASE_URL).",
  ].join("\n");
}

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * Strict ISO 8601: a date (UTC midnight) or an instant with an explicit
 * offset. `new Date(value)` alone would take "5" or "2026-02-30" and make a
 * different watermark than the one meant. Returns the UTC instant, or null.
 */
export function parseIsoInstant(value: string): string | null {
  const m = ISO_INSTANT.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  if (m[4] !== undefined) {
    if (Number(m[4]) > 23 || Number(m[5]) > 59) return null;
    if (m[6] !== undefined && Number(m[6]) > 59) return null;
    const offset = m[7].match(/^[+-](\d{2}):(\d{2})$/);
    if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) {
      return null;
    }
  }
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
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
    const instant = parseIsoInstant(values.since);
    if (!instant) {
      throw new UsageError(
        `--since must be an ISO 8601 date or instant (2026-11-01, 2026-11-01T10:00:00Z) or "last" (got "${values.since}")`,
      );
    }
    since = instant;
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
  /** Variables that must be set for any run; a missing one exits 2 before anything starts. */
  requireEnv?: readonly string[];
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

export function formatSummary(outcomes: Outcome[]): string {
  const header = [
    "entity",
    "adapter",
    "status",
    ...INGEST_COUNT_KEYS,
    "duration",
    "run",
  ];
  const rows = outcomes.map((o) => [
    o.entity,
    o.adapter,
    o.status,
    ...INGEST_COUNT_KEYS.map((c) => String(o.counts?.[c] ?? "-")),
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

  const missing = (deps.requireEnv ?? []).filter((name) => !env[name]);
  if (missing.length > 0) {
    stderr(`${missing.join(", ")} not set (see .env.example)`);
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

  // Build every adapter before running anything: a missing credential is a
  // configuration problem (exit 2), not a run that failed.
  const adapters = new Map<string, SourceAdapter>();
  try {
    for (const entity of args.entities) {
      adapters.set(entity, registry.get(entity)!.adapters[args.source](ctx));
    }
  } catch (err) {
    stderr(err instanceof Error ? err.message : String(err));
    return 2;
  }

  const outcomes: Outcome[] = [];
  for (const entity of args.entities) {
    const entry = registry.get(entity)!;
    const adapter = adapters.get(entity)!;
    const started = Date.now();
    try {
      const result = await lock(`ingest:${entity}`, async () => {
        // Read after taking the lock: a run ahead of us may have advanced it.
        let since = args.since;
        if (since === "last") {
          since =
            (await readWatermark({
              sourceSystem: adapter.source,
              adapter: adapter.name,
              entity,
            })) ?? undefined;
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
        adapter: adapter.name,
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
      requireEnv: ["DATABASE_URL"],
      lock: (key, fn) => withAdvisoryLock(db, key, fn),
    });
  } finally {
    await closeDb();
  }
}
