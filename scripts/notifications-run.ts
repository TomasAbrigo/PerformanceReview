/**
 * pnpm notifications:run [--as-of YYYY-MM-DD] [--offsets 7,1,0]
 *
 * Creates the due-date reminders (internal inbox; no email in v1) for the
 * pending tasks whose due date is --as-of (default: today in the company
 * time zone) plus each offset. Idempotent: run it daily from cron, more than
 * once is harmless. `pnpm notifications:run --help` for more.
 */
import { cliMain } from "../src/modules/notifications/cli";

await cliMain(process.argv.slice(2));
