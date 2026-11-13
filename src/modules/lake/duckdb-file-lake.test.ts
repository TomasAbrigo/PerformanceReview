// @vitest-environment node
import { DuckDBInstance } from "@duckdb/node-api";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("only lists regular files: a folder named like a table is not a table", async () => {
    const dir = await tempDir({ "b.csv": "id\n1\n" });
    await mkdir(join(dir, "employee.parquet")); // e.g. a hive-style folder
    await mkdir(join(dir, "other.csv"));
    const lake = await DuckDbFileLake.open(dir);

    expect(await lake.listTables()).toEqual(["b"]);
    await lake.close();
  });

  it("refuses a table that uses the column name the adapter reserves for paging", async () => {
    const dir = await tempDir({ "t.csv": "id,__lake_row_position\n1,x\n" });
    const lake = await DuckDbFileLake.open(dir);

    await expect(lake.describeTable("t")).rejects.toThrow(
      /__lake_row_position.*reserved/i,
    );
    await expect(readAll(lake, "t", { keyColumns: ["id"] })).rejects.toThrow(
      /reserved/i,
    );
    await lake.close();
  });

  it("can be closed twice", async () => {
    const lake = await DuckDbFileLake.open(fixtureDir("initial"));

    await lake.close();

    await expect(lake.close()).resolves.toBeUndefined();
  });
});

describe("DuckDbFileLake `since`", () => {
  const sinceIds = async (
    files: Record<string, string>,
    watermarkColumn: string,
    since: string,
  ) => {
    const lake = await DuckDbFileLake.open(await tempDir(files));
    const rows = await readAll(lake, "t", {
      keyColumns: ["id"],
      watermarkColumn,
      since,
    });
    await lake.close();
    return rows.map((row) => row.id);
  };
  const zoneless = {
    "t.csv":
      "id,changed\n1,2026-01-10 10:00:00\n2,2026-01-10 13:00:00\n3,2026-01-10 14:00:00\n",
  };

  it("is an instant: an offset is honoured on zone-less columns, which are read as UTC", async () => {
    // 10:30-03:00 is 13:30 UTC: only the 14:00 row is at or after it.
    expect(
      await sinceIds(zoneless, "changed", "2026-01-10T10:30:00-03:00"),
    ).toEqual(["3"]);
    expect(await sinceIds(zoneless, "changed", "2026-01-10T13:30:00Z")).toEqual(
      ["3"],
    );
    // A zone-less since is UTC as well.
    expect(await sinceIds(zoneless, "changed", "2026-01-10 13:00:00")).toEqual([
      "2",
      "3",
    ]);
  });

  it("works on DATE columns (the UTC date of the instant) and on numeric versions", async () => {
    const dates = {
      "t.csv": "id,day\n1,2026-01-09\n2,2026-01-10\n3,2026-01-11\n",
    };
    expect(await sinceIds(dates, "day", "2026-01-10")).toEqual(["2", "3"]);
    expect(await sinceIds(dates, "day", "2026-01-10T23:00:00Z")).toEqual([
      "2",
      "3",
    ]);
    const versions = { "t.csv": "id,version\n1,1\n2,2\n3,3\n" };
    expect(await sinceIds(versions, "version", "2")).toEqual(["2", "3"]);
  });
});

describe("DuckDbFileLake paging", () => {
  it("pages thousands of rows with heavy (watermark, key) ties, each exactly once and in file order within a tie", async () => {
    // 4000 rows over 3 watermarks x 10 keys: ~133 rows share each (wm, key),
    // so only the hidden row position can tell them apart. 4000 / 7 = 572
    // pages: the file must be read once, not once per page.
    const lines = ["id,changed,payload"];
    for (let i = 0; i < 4000; i++) {
      lines.push(`${i % 10},2026-01-0${(i % 3) + 1}T00:00:00Z,row-${i}`);
    }
    const dir = await tempDir({ "t.csv": lines.join("\n") + "\n" });
    const lake = await DuckDbFileLake.open(dir);
    const opts = { keyColumns: ["id"], watermarkColumn: "changed" };

    const whole = await readAll(lake, "t", { ...opts, batchSize: 5000 });
    const paged = await readAll(lake, "t", { ...opts, batchSize: 7 });

    expect(whole).toHaveLength(4000);
    expect(new Set(whole.map((r) => r.payload)).size).toBe(4000);
    expect(paged).toEqual(whole); // same rows, same order, nothing lost
    // Within a (watermark, key) tie rows keep the order of the file.
    const firstTie = whole
      .filter((r) => r.id === "0" && String(r.changed).startsWith("2026-01-01"))
      .map((r) => Number(String(r.payload).slice(4)));
    expect(firstTie.length).toBeGreaterThan(100);
    expect(firstTie).toEqual([...firstTie].sort((a, b) => a - b));
    await lake.close();
  }, 30_000);

  it("takes a snapshot of a table on first use: editing the file mid-pass changes nothing", async () => {
    const dir = await tempDir({ "t.csv": "id\n1\n2\n3\n" });
    const lake = await DuckDbFileLake.open(dir);
    const seen: unknown[] = [];

    for await (const batch of lake.readBatches("t", {
      keyColumns: ["id"],
      batchSize: 1,
    })) {
      seen.push(...batch.rows.map((row) => row.id));
      // Rewrite the file after the first batch: the pass must not notice.
      await writeFile(join(dir, "t.csv"), "id\n7\n8\n9\n10\n");
    }

    expect(seen).toEqual(["1", "2", "3"]);
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
    db.closeSync();
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
