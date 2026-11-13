/**
 * Convert the csv fixtures of the lake adapter (src/modules/lake/__fixtures__)
 * to Parquet with DuckDB `COPY`.
 *
 *   pnpm fixtures:parquet [outDir]     (default: build/lake-parquet)
 *
 * Writes <outDir>/<scenario>/<table>.parquet. The output is gitignored; point
 * `DuckDbFileLake.open` at a scenario folder to read the Parquet variant.
 */
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  csvDirToParquet,
  FIXTURES_ROOT,
  fixtureDir,
} from "../src/modules/lake/fixtures";

const outDir = process.argv[2] ?? "build/lake-parquet";

const scenarios = (await readdir(FIXTURES_ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const scenario of scenarios) {
  const written = await csvDirToParquet(
    fixtureDir(scenario),
    join(outDir, scenario),
  );
  for (const file of written) console.log(relative(process.cwd(), file));
}
