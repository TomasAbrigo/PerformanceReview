// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runLakeAdapterContractTests } from "./contract";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { csvDirToParquet, fixtureDir } from "./fixtures";

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function parquetVariant(scenario: string): Promise<string> {
  const dest = await mkdtemp(join(tmpdir(), "lake-parquet-"));
  tempDirs.push(dest);
  await csvDirToParquet(fixtureDir(scenario), dest);
  return dest;
}

describe("csvDirToParquet", () => {
  it("writes one .parquet per .csv, keeping the table names", async () => {
    const dest = await parquetVariant("initial");

    expect((await readdir(dest)).sort()).toEqual([
      "employee.parquet",
      "employee_goal.parquet",
      "goal.parquet",
      "milestone.parquet",
    ]);
  });

  it("keeps the column types DuckDB inferred from the csv", async () => {
    const csv = await DuckDbFileLake.open(fixtureDir("initial"));
    const parquet = await DuckDbFileLake.open(await parquetVariant("initial"));

    expect(await parquet.describeTable("employee")).toEqual(
      await csv.describeTable("employee"),
    );
    await csv.close();
    await parquet.close();
  });
});

runLakeAdapterContractTests("DuckDbFileLake (parquet)", async (scenario) =>
  DuckDbFileLake.open(await parquetVariant(scenario)),
);
