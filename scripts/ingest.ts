/**
 * pnpm ingest <entity> --source fixture|bamboo [--dir path] [--since <iso>|last]
 * pnpm ingest --all --source fixture|bamboo
 *
 * Entities come from the registry in src/modules/ingest/registry.ts.
 * bamboo needs BAMBOO_COMPANY_DOMAIN and BAMBOO_API_KEY. Exits non-zero when
 * a run fails (1) or the arguments are wrong (2). `pnpm ingest --help` for more.
 */
import { cliMain } from "../src/modules/ingest/cli";

await cliMain(process.argv.slice(2));
