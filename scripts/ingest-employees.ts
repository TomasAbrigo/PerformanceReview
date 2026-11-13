/**
 * Alias of the generic CLI, kept for existing callers (docs, scripts):
 *   pnpm ingest:employees [--source fixture|bamboo] [--dir path] [--entity employee|job_history] [--since <iso>]
 * is `pnpm ingest <entity> ...` with --entity defaulting to employee and
 * --source defaulting to fixture. New code should call `pnpm ingest` directly.
 */
import { cliMain } from "../src/modules/ingest/cli";

const args = process.argv.slice(2);

let entity = "employee";
const rest: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--entity") {
    entity = args[++i] ?? "";
  } else if (arg.startsWith("--entity=")) {
    entity = arg.slice("--entity=".length);
  } else {
    rest.push(arg);
  }
}
const hasSource = rest.some(
  (a) => a === "--source" || a.startsWith("--source="),
);

await cliMain([entity, ...(hasSource ? [] : ["--source", "fixture"]), ...rest]);
