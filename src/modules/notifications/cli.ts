import { parseArgs } from "node:util";
import { closeDb, db, type DbOrTx } from "@/db/client";
import { parseIsoDate } from "@/modules/org-history/dates";
import { DEFAULT_REMINDER_OFFSETS, generateDueReminders } from "./reminders";

/** Bad command line: printed with the usage text, exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type NotificationsCliArgs = {
  /** YYYY-MM-DD; undefined: today in the company time zone. */
  asOf: string | undefined;
  offsets: number[] | undefined;
};

export function usage(): string {
  return [
    "Usage:",
    "  pnpm notifications:run [--as-of YYYY-MM-DD] [--offsets 7,1,0]",
    "",
    "Creates the due-date reminders (internal inbox, no email) for every",
    "pending task whose due date is exactly --as-of plus one of the offsets",
    `(days; default ${DEFAULT_REMINDER_OFFSETS.join(",")}). --as-of defaults to today in the company`,
    "time zone. Safe to run more than once a day: a reminder is created once.",
    "",
    "Exit code: 0 ok, 2 bad arguments or configuration (DATABASE_URL).",
  ].join("\n");
}

export function parseNotificationsArgs(argv: string[]): NotificationsCliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "as-of": { type: "string" },
        offsets: { type: "string" },
      },
    });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const { values, positionals } = parsed;
  if (positionals.length > 0) {
    throw new UsageError(`Unexpected argument: ${positionals.join(" ")}`);
  }

  let asOf: string | undefined;
  if (values["as-of"] !== undefined) {
    asOf = parseIsoDate(values["as-of"]) ?? undefined;
    if (!asOf) {
      throw new UsageError(
        `--as-of must be a calendar date YYYY-MM-DD (got "${values["as-of"]}")`,
      );
    }
  }

  let offsets: number[] | undefined;
  if (values.offsets !== undefined) {
    const parts = values.offsets.split(",");
    offsets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
    if (offsets.some((n) => Number.isNaN(n) || n > 365)) {
      throw new UsageError(
        `--offsets must be a comma-separated list of days 0-365 (got "${values.offsets}")`,
      );
    }
  }
  return { asOf, offsets };
}

export type NotificationsCliDeps = {
  db: DbOrTx;
  env?: Record<string, string | undefined>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Variables that must be set; a missing one exits 2 before anything runs. */
  requireEnv?: readonly string[];
};

/** Runs the reminder generator; returns the exit code (0 ok, 2 bad usage). */
export async function runNotificationsCli(
  argv: string[],
  deps: NotificationsCliDeps,
): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? console.log;
  const stderr = deps.stderr ?? console.error;

  if (argv.includes("--help") || argv.includes("-h")) {
    stdout(usage());
    return 0;
  }
  let args: NotificationsCliArgs;
  try {
    args = parseNotificationsArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr(err.message);
    stderr("");
    stderr(usage());
    return 2;
  }
  const missing = (deps.requireEnv ?? []).filter((name) => !env[name]);
  if (missing.length > 0) {
    stderr(`${missing.join(", ")} not set (see .env.example)`);
    return 2;
  }

  const result = await generateDueReminders(deps.db, args);
  stdout(
    `notifications: as-of ${result.asOf}, offsets ${result.offsets.join(",")}: ` +
      `candidates=${result.candidates} created=${result.created} ` +
      `existing=${result.candidates - result.created}`,
  );
  return 0;
}

/** Entry point of the script: load env, run, close the pool, set the exit code. */
export async function cliMain(argv: string[]): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // rely on the real environment
  }
  try {
    process.exitCode = await runNotificationsCli(argv, {
      db,
      env: process.env,
      requireEnv: ["DATABASE_URL"],
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
