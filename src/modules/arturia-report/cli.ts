import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { closeDb, db, type DbOrTx } from "@/db/client";
import { DomainError } from "@/lib/domain-error";
import { PRIVATE_DIR } from "@/lib/sensitive-data";
import { UsageError } from "@/modules/ingest/cli";
import { fold } from "@/modules/qualitative-analysis/dimension";
import { ZodError } from "zod";
import { buildReport, resolveCycle } from "./build";
import { labelsFor, reportLocales, type ReportLocale } from "./labels";
import { renderHtml, renderJson } from "./render";

export const EXPORT_USAGE = [
  "Usage: pnpm export:arturia --cycle <id|name|latest> [--anonymized] [--out <dir>] [--locale es|en]",
  `  Writes report(.anonymized).json and .html; default dir ${PRIVATE_DIR}arturia/<cycle-slug>/.`,
  "  --anonymized: no names or emails, groups under aggregation.minGroupSize folded into Otros.",
  "Exit code: 0 ok, 1 the export failed, 2 bad arguments.",
].join("\n");

export type ExportArgs = {
  cycle: string;
  anonymized: boolean;
  out?: string;
  locale: ReportLocale;
};

export function parseExportArgs(argv: string[]): ExportArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        cycle: { type: "string" },
        anonymized: { type: "boolean", default: false },
        out: { type: "string" },
        locale: { type: "string", default: "es" },
      },
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  if (!values.cycle) throw new UsageError("--cycle is required");
  if (values.out === "") throw new UsageError("--out must be a directory");
  const locale = values.locale ?? "es";
  if (!(reportLocales as readonly string[]).includes(locale)) {
    throw new UsageError(`--locale must be es or en (got ${locale})`);
  }
  return {
    cycle: values.cycle,
    anonymized: values.anonymized ?? false,
    out: values.out,
    locale: locale as ReportLocale,
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

/** What went wrong, without data: the error, or the schema paths that failed. */
export function failureOf(e: unknown): string {
  if (e instanceof ZodError) {
    return `report does not match the schema at ${e.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`;
  }
  if (e instanceof DomainError) return e.code;
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

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
      cycle,
      anonymized: args.anonymized,
      locale: args.locale,
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
    await writeFile(htmlPath, renderHtml(report, labelsFor(args.locale)));
    const s = report.sections;
    out(
      `arturia export (${report.anonymized ? "anonymized" : "named"}): ${s.executive.participants} participants, ${s.people?.length ?? 0} person rows, ${s.qualitative?.topThemes.length ?? 0} themes`,
    );
    out(`  ${jsonPath}`);
    out(`  ${htmlPath}`);
    return 0;
  } catch (e) {
    err(`export failed: ${failureOf(e)}`);
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
