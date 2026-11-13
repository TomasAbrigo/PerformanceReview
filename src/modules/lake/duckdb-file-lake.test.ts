// @vitest-environment node
import { DuckDBInstance } from "@duckdb/node-api";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runLakeAdapterContractTests } from "./contract";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { fixtureDir } from "./fixtures";
import type { LakeRow, ReadOptions } from "./types";

const run = promisify(execFile);

runLakeAdapterContractTests("DuckDbFileLake (csv)", (scenario) =>
  DuckDbFileLake.open(fixtureDir(scenario)),
);

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs = [];
});
async function tempDir(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lake-test-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}
async function readAll(
  lake: DuckDbFileLake,
  table: string,
  opts: ReadOptions,
): Promise<LakeRow[]> {
  const rows: LakeRow[] = [];
  for await (const batch of lake.readBatches(table, opts)) {
    rows.push(...batch.rows);
  }
  return rows;
}

describe("DuckDbFileLake files", () => {
  it("reads csv, ndjson, jsonl and json files side by side, ignoring the rest", async () => {
    const dir = await tempDir({
      "a.csv": "id,v\n1,x\n",
      "b.ndjson": '{"id":2,"v":"y"}\n{"id":3,"v":"z"}\n',
      "c.jsonl": '{"id":4,"v":"w"}\n',
      "d.json": '[{"id":5,"v":"u"}]',
      "notes.txt": "not a table",
      ".hidden.csv.swp": "junk",
    });
    const lake = await DuckDbFileLake.open(dir);

    expect(await lake.listTables()).toEqual(["a", "b", "c", "d"]);
    expect(await readAll(lake, "b", { keyColumns: ["id"] })).toEqual([
      { id: "2", v: "y" },
      { id: "3", v: "z" },
    ]);
    expect(await readAll(lake, "d", { keyColumns: ["id"] })).toEqual([
      { id: "5", v: "u" },
    ]);
    await lake.close();
  });

  it("quotes table and column names it gets from files", async () => {
    const dir = await tempDir({
      "Employee Performance 2025.csv": `"Self: Feels ""Valued""",it's,id\nmostly,1,7\n`,
    });
    const lake = await DuckDbFileLake.open(dir);

    expect(await lake.listTables()).toEqual(["Employee Performance 2025"]);
    expect(
      await readAll(lake, "Employee Performance 2025", {
        keyColumns: ["id"],
        columns: [`Self: Feels "Valued"`, "it's"],
      }),
    ).toEqual([{ id: "7", [`Self: Feels "Valued"`]: "mostly", "it's": "1" }]);
    await lake.close();
  });

  it("refuses a directory where two files claim the same table", async () => {
    const dir = await tempDir({
      "employee.csv": "id\n1\n",
      "employee.ndjson": '{"id":1}\n',
    });

    await expect(DuckDbFileLake.open(dir)).rejects.toThrow(
      /ambiguous.*employee/i,
    );
  });
});

describe("DuckDbFileLake paging", () => {
  it("pages thousands of rows with heavy ties and exact duplicates, each exactly once", async () => {
    // 3000 rows over 3 watermarks x 10 keys: 100 rows share each (wm, key).
    const lines = ["id,changed,payload"];
    for (let i = 0; i < 3000; i++) {
      lines.push(`${i % 10},2026-01-0${(i % 3) + 1}T00:00:00Z,row-${i}`);
    }
    const dir = await tempDir({ "t.csv": lines.join("\n") + "\n" });
    const lake = await DuckDbFileLake.open(dir);
    const opts = { keyColumns: ["id"], watermarkColumn: "changed" };

    const whole = await readAll(lake, "t", { ...opts, batchSize: 5000 });
    const paged = await readAll(lake, "t", { ...opts, batchSize: 7 });

    expect(whole).toHaveLength(3000);
    expect(new Set(whole.map((r) => r.payload)).size).toBe(3000);
    expect(paged).toEqual(whole); // same rows, same order, nothing lost
    await lake.close();
  });
});

describe("DuckDbFileLake types", () => {
  it("renders DECIMAL and BIGINT as strings and keeps INTEGER/DOUBLE as numbers", async () => {
    const dir = await tempDir();
    const db = await DuckDBInstance.create(":memory:");
    const conn = await db.connect();
    await conn.run(
      `COPY (SELECT 1::INTEGER AS id, 12.50::DECIMAL(10,2) AS amount,
                    9007199254740993::BIGINT AS big, 0.1::DOUBLE AS ratio,
                    TIMESTAMPTZ '2026-01-01 10:00:00+00' AS at)
       TO '${join(dir, "ledger.parquet")}' (FORMAT PARQUET)`,
    );
    conn.closeSync();
    const lake = await DuckDbFileLake.open(dir);

    const columns = await lake.describeTable("ledger");
    const rows = await readAll(lake, "ledger", { keyColumns: ["id"] });

    expect(columns.find((c) => c.name === "amount")?.type).toBe(
      "DECIMAL(10,2)",
    );
    expect(rows).toEqual([
      {
        id: 1,
        amount: "12.50",
        big: "9007199254740993",
        ratio: 0.1,
        at: "2026-01-01 10:00:00+00",
      },
    ]);
    await lake.close();
  });
});

describe("DuckDbFileLake specifics", () => {
  it("renders timestamps in UTC even when the process runs in another time zone", async () => {
    // DuckDB's node driver reads TZ once, at process start: a child is the
    // only way to force a zone (set TZ here and nothing changes).
    const lakeModule = fileURLToPath(
      new URL("./duckdb-file-lake.ts", import.meta.url),
    );
    const script = `
      const { DuckDbFileLake } = await import(${JSON.stringify(lakeModule)});
      const lake = await DuckDbFileLake.open(${JSON.stringify(fixtureDir("initial"))});
      const rows = [];
      for await (const batch of lake.readBatches("goal", { keyColumns: ["id"], watermarkColumn: "_fivetran_synced" })) {
        rows.push(...batch.rows);
      }
      console.log(JSON.stringify(rows));
      await lake.close();
    `;

    const { stdout } = await run(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { env: { ...process.env, TZ: "Asia/Kolkata" }, cwd: process.cwd() },
    );

    const rows = JSON.parse(stdout) as Record<string, string | null>[];
    const goal = rows.find((row) => row.id === "302");
    expect(goal?.completed_at).toMatch(/^2025-12-10 15:30:00/); // not 21:00+05:30
    expect(goal?._fivetran_synced).toMatch(/^2026-01-10 10:00:00/);
  }, 30_000);
});
