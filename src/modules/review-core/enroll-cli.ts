import { parseArgs } from "node:util";
import type { DbOrTx } from "@/db/client";
import { isUuid } from "@/lib/uuid";
import { parseIsoDate, todayLocal } from "@/modules/org-history/dates";
import {
  enrollAllDueParticipants,
  enrollDueParticipants,
  type EnrollResult,
} from "./hire-date";

export const ENROLL_USAGE = `Usage: pnpm cycles:enroll [--cycle <id>] [--as-of YYYY-MM-DD] [--lookback-days N]

Enrolls into launched hire-date cycles everyone whose hire date + milestone
falls within the cycle's window ending on --as-of (default: today in the
company time zone). Without --cycle it runs on every active hire-date cycle.
Safe to run any number of times (idempotent): run it once a day.
People due but without job history yet are listed as skipped and retried on
the next runs; --lookback-days N (0-365) also looks N days further back than
the window (catching up after an outage).
Exit status: 0 ok, 1 a cycle failed, 2 wrong arguments.`;

export type EnrollArgs = {
  help: boolean;
  cycleId?: string;
  asOf?: string;
  lookbackDays?: number;
};

export class UsageError extends Error {}

export function parseEnrollArgs(argv: string[]): EnrollArgs {
  let values;
  try {
    values = parseArgs({
      args: argv,
      options: {
        cycle: { type: "string" },
        "as-of": { type: "string" },
        "lookback-days": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (values.cycle !== undefined && !isUuid(values.cycle)) {
    throw new UsageError("--cycle must be a cycle id (uuid)");
  }
  if (values["as-of"] !== undefined && !parseIsoDate(values["as-of"])) {
    throw new UsageError("--as-of must be a real date as YYYY-MM-DD");
  }
  const lookback = values["lookback-days"];
  if (
    lookback !== undefined &&
    !(/^\d+$/.test(lookback) && Number(lookback) <= 365)
  ) {
    throw new UsageError(
      "--lookback-days must be a whole number from 0 to 365",
    );
  }
  return {
    help: values.help ?? false,
    ...(values.cycle !== undefined && { cycleId: values.cycle }),
    ...(values["as-of"] !== undefined && { asOf: values["as-of"] }),
    ...(lookback !== undefined && { lookbackDays: Number(lookback) }),
  };
}

function report(result: EnrollResult, out: (line: string) => void) {
  out(
    `cycle ${result.cycleId} as of ${result.asOf}: ${result.enrolled.length} enrolled`,
  );
  for (const e of result.enrolled) {
    out(
      `  ${e.displayName}: hired ${e.hireDate}, milestone ${e.milestoneDate}, due ${e.dueDates.self}`,
    );
  }
  for (const p of result.skipped) {
    out(`  skipped ${p.displayName} (hired ${p.hireDate}): ${p.reason}`);
  }
  if (result.error) out(`  error: ${result.error}`);
}

/** The `pnpm cycles:enroll` command; returns the process exit code. */
export async function enrollCli(
  argv: string[],
  io: { db: DbOrTx; out?: (line: string) => void },
): Promise<number> {
  const out = io.out ?? ((line: string) => console.log(line));
  let args: EnrollArgs;
  try {
    args = parseEnrollArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    out(`${error.message}\n${ENROLL_USAGE}`);
    return 2;
  }
  if (args.help) {
    out(ENROLL_USAGE);
    return 0;
  }

  const asOf = args.asOf ?? todayLocal();
  const opts = { lookbackDays: args.lookbackDays };
  let results: EnrollResult[];
  if (args.cycleId) {
    try {
      results = [await enrollDueParticipants(io.db, args.cycleId, asOf, opts)];
    } catch (error) {
      results = [
        {
          cycleId: args.cycleId,
          asOf,
          enrolled: [],
          skipped: [],
          error: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  } else {
    results = await enrollAllDueParticipants(io.db, asOf, opts);
    if (results.length === 0) out(`no active hire-date cycles as of ${asOf}`);
  }
  for (const result of results) report(result, out);
  return results.some((r) => r.error) ? 1 : 0;
}
