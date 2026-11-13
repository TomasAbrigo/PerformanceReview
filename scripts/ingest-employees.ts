/**
 * Alias of `pnpm ingest employee`: pnpm ingest:employees [--source fixture|bamboo] [--dir path]
 * Kept for existing callers (e2e, docs); defaults to --source fixture as before.
 */
import { cliMain } from "../src/modules/ingest/cli";

const args = process.argv.slice(2);
const hasSource = args.some(
  (a) => a === "--source" || a.startsWith("--source="),
);

await cliMain([
  "employee",
  ...(hasSource ? [] : ["--source", "fixture"]),
  ...args,
]);
