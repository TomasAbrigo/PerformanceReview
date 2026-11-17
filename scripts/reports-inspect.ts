/**
 * pnpm reports:inspect <file>
 *
 * Headers, row count and per-column non-empty / distinct counts of a Bamboo
 * report export (csv, xlsx, parquet, ndjson), never a cell value. No database.
 * Exit code: 0 printed, 1 the file could not be read, 2 bad arguments.
 */
import { runInspectCli } from "../src/modules/lake/report-inspect";

runInspectCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
