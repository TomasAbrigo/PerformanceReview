import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { closeDb, db, type DbOrTx } from "@/db/client";
import { DomainError } from "@/lib/domain-error";
import { PRIVATE_DIR } from "@/lib/sensitive-data";
import { UsageError } from "@/modules/ingest/cli";
import { fold } from "@/modules/qualitative-analysis/dimension";
import { buildReport, resolveCycle } from "./build";
import { renderHtml, renderJson } from "./render";

export const EXPORT_USAGE = [
  "Usage: pnpm export:arturia --cycle <id|name|latest> [--anonymized] [--out <dir>]",
  `  Writes report(.anonymized).json and .html; default dir ${PRIVATE_DIR}arturia/<cycle-slug>/.`,
  "  --anonymized: no names or emails, groups under aggregation.minGroupSize folded into Otros.",
  "Exit code: 0 ok, 1 the export failed, 2 bad arguments.",
].join("\n");

export type ExportArgs = { cycle: string; anonymized: boolean; out?: string };

export function parseExportArgs(argv: string[]): ExportArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        cycle: { type: "string" },
        anonymized: { type: "boolean", default: false },
        out: { type: "string" },
      },
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  if (!values.cycle) throw new UsageError("--cycle is required");
  if (values.out === "") throw new UsageError("--out must be a directory");
  return {
    cycle: values.cycle,
    anonymized: values.anonymized ?? false,
    out: values.out,
  };
}

/** "Evaluación 2024 (H1)" -> "evaluacion-2024-h1". */
export const cycleSlug = (name: string) =>
  fold(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ciclo";

/** Default output folder: under data/private (ignored by git). */
export const defaultOutDir = (cycleName: string) =>
  path.join(PRIVATE_DIR, "arturia", cycleSlug(cycleName));

export const reportFileNames = (anonymized: boolean) => {
  const base = anonymized ? "report.anonymized" : "report";
  return { json: `${base}.json`, html: `${base}.html` };
};

export type ExportCliDeps = {
  db: DbOrTx;
  /** Base of relative paths (default: process.cwd()). */
  cwd?: string;
  now?: Date;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
};

/** Runs `pnpm export:arturia`; returns the exit code. Prints paths and counts, never names. */
export async function runExportCli(
  argv: string[],
  deps: ExportCliDeps,
): Promise<number> {
  const out = deps.stdout ?? console.log;
  const err = deps.stderr ?? console.error;
  let args: ExportArgs;
  try {
    args = parseExportArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      err(`${e.message}\n\n${EXPORT_USAGE}`);
      return 2;
    }
    throw e;
  }
  try {
    const cycle = await resolveCycle(deps.db, args.cycle);
    const report = await buildReport(deps.db, {
      cycleId: cycle.id,
      anonymized: args.anonymized,
      now: deps.now,
    });
    const dir = path.resolve(
      deps.cwd ?? process.cwd(),
      args.out ?? defaultOutDir(cycle.name),
    );
    const names = reportFileNames(args.anonymized);
    await mkdir(dir, { recursive: true });
    const jsonPath = path.join(dir, names.json);
    const htmlPath = path.join(dir, names.html);
    await writeFile(jsonPath, renderJson(report));
    await writeFile(htmlPath, renderHtml(report));
    const s = report.sections;
    out(
      `arturia export (${report.anonymized ? "anonymized" : "named"}): ${s.executive.participants} participants, ${s.people?.length ?? 0} person rows, ${s.qualitative?.topThemes.length ?? 0} themes`,
    );
    out(`  ${jsonPath}`);
    out(`  ${htmlPath}`);
    return 0;
  } catch (e) {
    err(
      `export failed: ${e instanceof DomainError ? e.code : e instanceof Error ? e.name : "error"}`,
    );
    return 1;
  }
}

/** Entry point of the script: load env, run, close the pool, set the exit code. */
export async function cliMain(argv: string[]): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // rely on the real environment
  }
  try {
    process.exitCode = await runExportCli(argv, { db });
  } finally {
    await closeDb();
  }
}
