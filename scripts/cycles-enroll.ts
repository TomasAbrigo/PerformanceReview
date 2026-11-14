/**
 * pnpm cycles:enroll [--cycle <id>] [--as-of YYYY-MM-DD]
 *
 * Enrolls into launched hire-date cycles whoever reached the milestone.
 * Idempotent; meant for a daily cron (see README). Exits 1 when a cycle
 * fails and 2 on wrong arguments. `pnpm cycles:enroll --help` for more.
 */
import { closeDb, db } from "../src/db/client";
import { enrollCli } from "../src/modules/review-core/enroll-cli";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the real environment
}

try {
  process.exitCode = await enrollCli(process.argv.slice(2), { db });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
