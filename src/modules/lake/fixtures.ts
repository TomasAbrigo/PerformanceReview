import { DuckDBInstance } from "@duckdb/node-api";
import { mkdir, readdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sqlString } from "./sql";

/** Directory holding one sub-directory of hand-written files per scenario. */
export const FIXTURES_ROOT = fileURLToPath(
  new URL("./__fixtures__", import.meta.url),
);

/** Directory of the hand-written fixture lake for a scenario. */
export function fixtureDir(scenario: string): string {
  return join(FIXTURES_ROOT, scenario);
}

/**
 * Convert every `<table>.csv` in `srcDir` to `<table>.parquet` in `destDir`
 * with DuckDB `COPY`, keeping the types DuckDB infers from the csv. Used to
 * run the contract suite against Parquet without committing binary files.
 */
export async function csvDirToParquet(
  srcDir: string,
  destDir: string,
): Promise<string[]> {
  await mkdir(destDir, { recursive: true });
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    await conn.run(`SET TimeZone='UTC'`);
    const written: string[] = [];
    for (const file of (await readdir(srcDir)).sort()) {
      if (extname(file) !== ".csv") continue;
      const target = resolve(destDir, `${basename(file, ".csv")}.parquet`);
      await conn.run(
        `COPY (SELECT * FROM read_csv(${sqlString(resolve(srcDir, file))}, sample_size=-1))
         TO ${sqlString(target)} (FORMAT PARQUET)`,
      );
      written.push(target);
    }
    return written;
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}
