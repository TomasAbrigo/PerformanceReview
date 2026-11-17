/**
 * pnpm export:arturia --cycle <id|name|latest> [--anonymized] [--out <dir>]
 *
 * Writes the Arturía report (JSON + self-contained HTML) of a cycle; see
 * docs/arturia.md. Exit 0 ok, 1 failed, 2 usage.
 */
import { cliMain } from "../src/modules/arturia-report/cli";

await cliMain(process.argv.slice(2));
