import { parseArgs } from "node:util";
import { closeDb, db, type DbOrTx } from "@/db/client";
import { DomainError } from "@/lib/domain-error";
import { isUuid } from "@/lib/uuid";
import { UsageError } from "@/modules/ingest/cli";
import { createProvider, type MessagesClient } from "./anthropic-provider";
import { analysisProviderNames } from "./constants";
import { importLabels } from "./import-labels";
import { runAnalysis } from "./service";

type Env = Record<string, string | undefined>;
export type AnalysisCliDeps = {
  db: DbOrTx;
  env: Env;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Injected SDK client (tests). */
  client?: MessagesClient;
};

export const RUN_USAGE = [
  "Usage: pnpm analysis:run [--cycle <id>] [--provider mock|anthropic]",
  "  Labels open-text answers (sentiment + themes). Default provider: ANALYSIS_PROVIDER or mock.",
  "  anthropic needs ANTHROPIC_API_KEY (ANALYSIS_MODEL overrides the model).",
  "Exit code: 0 ok, 1 the run failed, 2 bad arguments or configuration.",
].join("\n");
export const IMPORT_USAGE = [
  "Usage: pnpm analysis:import-labels <file.csv>",
  "  Imports labels from a CSV (docs/qualitative-labels.md); prints the rows that did not match.",
  "Exit code: 0 ok, 1 the import failed, 2 bad arguments.",
].join("\n");

export function parseRunArgs(argv: string[]): {
  cycleId?: string;
  provider?: string;
} {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { cycle: { type: "string" }, provider: { type: "string" } },
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  if (values.cycle !== undefined && !isUuid(values.cycle)) {
    throw new UsageError(
      `--cycle must be a cycle id (uuid), got "${values.cycle}"`,
    );
  }
  if (
    values.provider !== undefined &&
    !(analysisProviderNames as readonly string[]).includes(values.provider)
  ) {
    throw new UsageError(
      `--provider must be mock or anthropic (got ${values.provider})`,
    );
  }
  return { cycleId: values.cycle, provider: values.provider };
}

/** Runs `pnpm analysis:run`; returns the exit code. Prints counts, never text. */
export async function runAnalysisCli(
  argv: string[],
  deps: AnalysisCliDeps,
): Promise<number> {
  const out = deps.stdout ?? console.log;
  const err = deps.stderr ?? console.error;
  let args;
  let provider;
  try {
    args = parseRunArgs(argv);
    provider = createProvider(deps.env, {
      override: args.provider,
      client: deps.client,
    });
  } catch (e) {
    if (e instanceof UsageError || e instanceof DomainError) {
      err(`${e.message}\n\n${RUN_USAGE}`);
      return 2;
    }
    throw e;
  }
  try {
    const r = await runAnalysis(deps.db, { cycleId: args.cycleId, provider });
    out(
      `analysis ${provider.name}: ${r.total} texts, ${r.analyzed} analyzed, ${r.cached} cached, ${r.corrected} corrected by hand (run ${r.runId})`,
    );
    return 0;
  } catch (e) {
    err(
      `analysis failed: ${e instanceof DomainError ? e.code : e instanceof Error ? e.name : "error"}`,
    );
    return 1;
  }
}

/** Runs `pnpm analysis:import-labels <file>`; returns the exit code. */
export async function importLabelsCli(
  argv: string[],
  deps: AnalysisCliDeps,
): Promise<number> {
  const out = deps.stdout ?? console.log;
  const err = deps.stderr ?? console.error;
  let positionals;
  try {
    ({ positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {},
    }));
  } catch (e) {
    err(`${e instanceof Error ? e.message : String(e)}\n\n${IMPORT_USAGE}`);
    return 2;
  }
  if (positionals.length !== 1) {
    err(`Expected one CSV file\n\n${IMPORT_USAGE}`);
    return 2;
  }
  try {
    const r = await importLabels(deps.db, { csvPath: positionals[0] });
    out(
      `labels: ${r.total} rows, ${r.matched} matched, ${r.unmatched.length} unmatched (run ${r.runId})`,
    );
    for (const u of r.unmatched) out(`  row ${u.line}: ${u.reason}`);
    return 0;
  } catch (e) {
    err(
      `import failed: ${e instanceof DomainError ? e.message : e instanceof Error ? e.message : "error"}`,
    );
    return 1;
  }
}

/** Entry point of the scripts: load env, run, close the pool, set the exit code. */
export async function cliMain(
  run: (argv: string[], deps: AnalysisCliDeps) => Promise<number>,
  argv: string[],
): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // rely on the real environment
  }
  try {
    process.exitCode = await run(argv, { db, env: process.env });
  } finally {
    await closeDb();
  }
}
