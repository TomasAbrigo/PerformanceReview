import { afterEach, describe, expect, it } from "vitest";
import type { LakeAdapter, LakeBatch, LakeRow, ReadOptions } from "./types";

/**
 * Scenarios every implementation must be able to serve. Each one is a lake
 * state described in `__fixtures__/<scenario>/` (see README, "Lake adapter").
 *
 * - initial:      first full sync (employee, goal, employee_goal, milestone)
 * - delta-1:      next sync: one update, one insert, one soft-delete
 * - schema-drift: employee with a new column and a changed column type
 * - messy:        NULLs, duplicate keys, equal and NULL watermarks, big ids
 */
export type LakeScenario = "initial" | "delta-1" | "schema-drift" | "messy";

export type OpenLakeAdapter = (scenario: LakeScenario) => Promise<LakeAdapter>;

const EMPLOYEE_READ: ReadOptions = {
  keyColumns: ["id"],
  watermarkColumn: "_fivetran_synced",
};

async function collect(gen: AsyncGenerator<LakeBatch>): Promise<LakeBatch[]> {
  const batches: LakeBatch[] = [];
  for await (const batch of gen) batches.push(batch);
  return batches;
}

const ids = (rows: LakeRow[]) => rows.map((row) => String(row.id));

/**
 * Epoch ms of a timestamp string, whatever the adapter's spelling
 * (`2026-01-10 10:00:00+00`, `2026-01-10T10:00:00Z`...). Zone-less values
 * are taken as UTC.
 */
function epochMs(value: unknown): number {
  let text = String(value).trim().replace(" ", "T");
  text = text.replace(/(T.*[+-]\d{2})$/, "$1:00");
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(text)) text += "Z";
  return Date.parse(text);
}

/**
 * Behavioural contract of a `LakeAdapter`. Call it from a `*.test.ts` file
 * with a factory that opens the adapter over the scenario's data; real
 * adapters (BigQuery, Snowflake...) must pass the same suite.
 */
export function runLakeAdapterContractTests(
  name: string,
  openAdapter: OpenLakeAdapter,
): void {
  describe(`LakeAdapter contract: ${name}`, () => {
    const opened: LakeAdapter[] = [];
    const open = async (scenario: LakeScenario) => {
      const adapter = await openAdapter(scenario);
      opened.push(adapter);
      return adapter;
    };
    afterEach(async () => {
      await Promise.all(opened.splice(0).map((a) => a.close()));
    });

    it("lists the tables of the lake sorted by name", async () => {
      const lake = await open("initial");

      expect(await lake.listTables()).toEqual([
        "employee",
        "employee_goal",
        "goal",
        "milestone",
      ]);
    });

    it("describes a table's columns in file order with a type each", async () => {
      const lake = await open("initial");

      const columns = await lake.describeTable("goal");

      expect(columns.map((c) => c.name)).toEqual([
        "id",
        "title",
        "percent_complete",
        "status",
        "due_date",
        "completed_at",
        "_fivetran_synced",
        "_fivetran_deleted",
      ]);
      for (const column of columns) {
        expect(column.type).toEqual(expect.any(String));
        expect(column.nullable).toEqual(expect.any(Boolean));
      }
    });

    it("rejects tables that are not in the lake", async () => {
      const lake = await open("initial");

      await expect(lake.describeTable("nope")).rejects.toThrow(
        /unknown table "nope"/i,
      );
    });

    it("reads a whole table ordered by (watermark, key) with JSON-safe rows", async () => {
      const lake = await open("initial");

      const batches = await collect(
        lake.readBatches("employee", EMPLOYEE_READ),
      );

      expect(batches).toHaveLength(1);
      const [batch] = batches;
      expect(ids(batch.rows)).toEqual(["101", "102", "103", "104", "105"]);
      expect(batch.rows[0]).toMatchObject({
        first_name: "Ana",
        last_name: "Lopez",
        work_email: "ana.lopez@example.test",
        hire_date: "2020-03-02",
        _fivetran_deleted: false,
      });
      expect(epochMs(batch.watermark)).toBe(Date.parse("2026-01-10T10:05:00Z"));
      expect(() => JSON.stringify(batch.rows)).not.toThrow();
    });

    it("with batchSize 1 returns every row exactly once, across watermark ties", async () => {
      // Four of the five rows share the same watermark: paging by watermark
      // alone would skip or repeat them.
      const lake = await open("initial");

      const batches = await collect(
        lake.readBatches("employee", { ...EMPLOYEE_READ, batchSize: 1 }),
      );

      expect(batches.map((b) => b.rows.length)).toEqual([1, 1, 1, 1, 1]);
      expect(ids(batches.flatMap((b) => b.rows))).toEqual([
        "101",
        "102",
        "103",
        "104",
        "105",
      ]);
      const watermarks = batches.map((b) => epochMs(b.watermark));
      expect(watermarks).toEqual([...watermarks].sort((a, b) => a - b));
    });

    it("splits rows into batches of at most batchSize, with no empty batch", async () => {
      const lake = await open("initial");

      const sizes = async (batchSize: number) =>
        (
          await collect(
            lake.readBatches("employee", { ...EMPLOYEE_READ, batchSize }),
          )
        ).map((b) => b.rows.length);

      expect(await sizes(2)).toEqual([2, 2, 1]);
      expect(await sizes(5)).toEqual([5]);
      expect(await sizes(100)).toEqual([5]);
    });

    it("re-reads rows at exactly `since` (at-least-once overlap) and pages them", async () => {
      const lake = await open("initial");
      const readIds = async (since: string, batchSize = 1000) =>
        ids(
          (
            await collect(
              lake.readBatches("employee", {
                ...EMPLOYEE_READ,
                since,
                batchSize,
              }),
            )
          ).flatMap((b) => b.rows),
        );

      // The newest row sits exactly at `since`: it is read again.
      expect(await readIds("2026-01-10T10:05:00Z")).toEqual(["105"]);
      // Four rows tie at `since`, plus the newer one; paging must not drop ties.
      expect(await readIds("2026-01-10T10:00:00Z", 2)).toEqual([
        "101",
        "102",
        "103",
        "104",
        "105",
      ]);
      expect(await readIds("2026-01-10T10:05:01Z")).toEqual([]);
    });

    it("reads `since` as an instant, whatever offset it is written with", async () => {
      const lake = await open("initial");

      const rows = (
        await collect(
          lake.readBatches("employee", {
            ...EMPLOYEE_READ,
            // 07:05 at -03:00 is 10:05 UTC, the watermark of the newest row.
            since: "2026-01-10T07:05:00-03:00",
          }),
        )
      ).flatMap((b) => b.rows);

      expect(ids(rows)).toEqual(["105"]);
    });

    it("accepts a watermark it handed out as `since`", async () => {
      const lake = await open("initial");
      const [first] = await collect(
        lake.readBatches("employee", { ...EMPLOYEE_READ, batchSize: 2 }),
      );

      const again = await collect(
        lake.readBatches("employee", {
          ...EMPLOYEE_READ,
          since: first.watermark,
        }),
      );

      // Watermark of the first batch is the 10:00:00 tie: everything is >= it.
      expect(ids(again.flatMap((b) => b.rows))).toEqual([
        "101",
        "102",
        "103",
        "104",
        "105",
      ]);
    });

    it("an incremental sync from the last watermark picks up the update, the insert and the soft-delete", async () => {
      const initial = await open("initial");
      const batches = await collect(
        initial.readBatches("employee", { ...EMPLOYEE_READ, batchSize: 2 }),
      );
      const committed = batches.at(-1)?.watermark; // what an ingest would persist
      const delta = await open("delta-1");

      const changes = (
        await collect(
          delta.readBatches("employee", {
            ...EMPLOYEE_READ,
            since: committed,
            batchSize: 2,
          }),
        )
      ).flatMap((b) => b.rows);

      // 105 is the boundary row re-read by the overlap; the rest are the changes.
      expect(ids(changes)).toEqual(["105", "102", "103", "106"]);
      const byId = new Map(changes.map((row) => [String(row.id), row]));
      expect(byId.get("102")).toMatchObject({ job_title: "Staff Engineer" });
      expect(byId.get("103")).toMatchObject({ _fivetran_deleted: true });
      expect(byId.get("106")).toMatchObject({
        first_name: "Flor",
        _fivetran_deleted: false,
      });
      expect(epochMs(byId.get("106")?._fivetran_synced)).toBe(
        Date.parse("2026-02-10T10:00:00Z"),
      );
    });

    it("reports schema drift through describeTable: new column and changed type", async () => {
      const before = await (await open("initial")).describeTable("employee");
      const lake = await open("schema-drift");

      const after = await lake.describeTable("employee");

      const typeOf = (columns: typeof before, name: string) =>
        columns.find((c) => c.name === name)?.type;
      expect(before.map((c) => c.name)).not.toContain("pronouns");
      expect(after.map((c) => c.name)).toContain("pronouns");
      // employee_number went from digits to "E-1001": the type must change.
      expect(typeOf(after, "employee_number")).toBeDefined();
      expect(typeOf(after, "employee_number")).not.toBe(
        typeOf(before, "employee_number"),
      );
      // Untouched columns keep their type.
      expect(typeOf(after, "id")).toBe(typeOf(before, "id"));
    });

    it("keeps reading a drifted table, new column included", async () => {
      const lake = await open("schema-drift");

      const [batch] = await collect(
        lake.readBatches("employee", EMPLOYEE_READ),
      );

      expect(ids(batch.rows)).toEqual(["101", "102", "103"]);
      expect(batch.rows[0]).toMatchObject({
        employee_number: "E-1001",
        pronouns: "she/her",
      });
      expect(batch.rows[2]).toMatchObject({ pronouns: null });
    });

    it("projects `columns`, always keeping the key and watermark columns", async () => {
      const lake = await open("initial");

      const [batch] = await collect(
        lake.readBatches("employee", {
          ...EMPLOYEE_READ,
          columns: ["first_name"],
        }),
      );

      expect(Object.keys(batch.rows[0]).sort()).toEqual(
        ["_fivetran_synced", "first_name", "id"].sort(),
      );
    });

    it("rejects invalid read options instead of building odd queries", async () => {
      const lake = await open("initial");
      const read = (table: string, opts: ReadOptions) =>
        collect(lake.readBatches(table, opts));

      await expect(read("nope", { keyColumns: ["id"] })).rejects.toThrow(
        /unknown table "nope"/i,
      );
      await expect(read("employee", { keyColumns: [] })).rejects.toThrow(
        /key column/i,
      );
      await expect(
        read("employee", { keyColumns: ["no_such_column"] }),
      ).rejects.toThrow(/unknown column "no_such_column"/i);
      await expect(
        read("employee", {
          keyColumns: ["id"],
          watermarkColumn: 'x" OR 1=1 --',
        }),
      ).rejects.toThrow(/unknown column/i);
      await expect(
        read("employee", { keyColumns: ["id"], columns: ["nope"] }),
      ).rejects.toThrow(/unknown column "nope"/i);
      await expect(
        read("employee", { keyColumns: ["id"], batchSize: 0 }),
      ).rejects.toThrow(/batchSize/);
    });

    it("renders BIGINT and DECIMAL columns as strings so no digit is lost", async () => {
      const lake = await open("messy");
      const columns = await lake.describeTable("employee");
      const exact = columns
        .filter((c) => /BIGINT|HUGEINT|DECIMAL|NUMERIC/i.test(c.type))
        .map((c) => c.name);

      const rows = (
        await collect(lake.readBatches("employee", EMPLOYEE_READ))
      ).flatMap((b) => b.rows);

      // 2^53 + 1 is not representable as a JS number.
      expect(exact).toContain("id");
      expect(rows.map((row) => row.id)).toContain("9007199254740993");
      for (const row of rows) {
        for (const name of exact) {
          expect(["string", "object"]).toContain(typeof row[name]); // string | null
        }
      }
    });

    it("renders timestamps as UTC wall-clock time, not in the machine's zone", async () => {
      // Fails on any non-UTC machine if an adapter leaks the process time
      // zone (drivers set it at process start; see duckdb-file-lake.test.ts
      // for the run under a forced zone).
      const lake = await open("initial");

      const [batch] = await collect(
        lake.readBatches("goal", {
          keyColumns: ["id"],
          watermarkColumn: "_fivetran_synced",
        }),
      );

      const goal = batch.rows.find((row) => String(row.id) === "302");
      expect(String(goal?.completed_at)).toMatch(/^2025-12-10[ T]15:30:00/);
      expect(epochMs(goal?.completed_at)).toBe(
        Date.parse("2025-12-10T15:30:00Z"),
      );
      expect(String(batch.watermark)).toMatch(/^2026-01-10[ T]10:05:00/);
    });

    describe("messy data", () => {
      // 8 rows: key 201 twice (two versions), key 205 twice (identical rows),
      // six rows tied on the watermark, one row with a NULL watermark, a
      // BIGINT id beyond 2^53, NULLs in other columns, quotes and accents.
      const MESSY_ORDER = [
        ["201", "Fede"],
        ["202", "Gabi"],
        ["203", "Hugo"],
        ["205", "Ines"],
        ["205", "Ines"],
        ["9007199254740993", "Kevin"],
        ["201", "Federico"],
        ["204", "Julia"], // NULL watermark: last
      ];
      const identity = (rows: LakeRow[]) =>
        rows.map((row) => [String(row.id), row.first_name]);

      it("with batchSize 1 returns every row exactly once, duplicates and ties included", async () => {
        const lake = await open("messy");

        const batches = await collect(
          lake.readBatches("employee", { ...EMPLOYEE_READ, batchSize: 1 }),
        );

        expect(identity(batches.flatMap((b) => b.rows))).toEqual(MESSY_ORDER);
      });

      it("returns the same rows whatever the batch size", async () => {
        const lake = await open("messy");

        for (const batchSize of [1, 2, 3, 7, 8, 9, 1000]) {
          const batches = await collect(
            lake.readBatches("employee", { ...EMPLOYEE_READ, batchSize }),
          );
          expect(identity(batches.flatMap((b) => b.rows))).toEqual(MESSY_ORDER);
        }
      });

      it("hands out the highest non-NULL watermark of each batch, null if there is none", async () => {
        const lake = await open("messy");

        const small = await collect(
          lake.readBatches("employee", { ...EMPLOYEE_READ, batchSize: 1 }),
        );
        const wide = await collect(
          lake.readBatches("employee", { ...EMPLOYEE_READ, batchSize: 3 }),
        );

        // The last row (Julia) has no watermark.
        expect(small.at(-1)?.watermark).toBeNull();
        expect(epochMs(small.at(-2)?.watermark)).toBe(
          Date.parse("2026-03-11T10:00:00Z"),
        );
        // Last batch of three = [Federico (03-11), Julia (NULL)]: not null.
        expect(wide.map((b) => b.rows.length)).toEqual([3, 3, 2]);
        expect(epochMs(wide.at(-1)?.watermark)).toBe(
          Date.parse("2026-03-11T10:00:00Z"),
        );
      });

      it("always re-reads rows with a NULL watermark on an incremental sync", async () => {
        const lake = await open("messy");

        const rows = (
          await collect(
            lake.readBatches("employee", {
              ...EMPLOYEE_READ,
              since: "2026-03-11T10:00:00Z",
              batchSize: 1,
            }),
          )
        ).flatMap((b) => b.rows);

        expect(identity(rows)).toEqual([
          ["201", "Federico"],
          ["204", "Julia"],
        ]);
      });

      it("keeps NULLs as null and text exactly as written", async () => {
        const lake = await open("messy");

        const rows = (
          await collect(lake.readBatches("employee", EMPLOYEE_READ))
        ).flatMap((b) => b.rows);

        const named = (name: string) =>
          rows.find((row) => row.first_name === name);
        expect(named("Fede")).toMatchObject({
          work_email: null,
          hire_date: null,
        });
        expect(named("Gabi")).toMatchObject({
          department: null,
          last_changed: null,
        });
        expect(named("Julia")).toMatchObject({
          last_name: "Nuñez",
          _fivetran_synced: null,
        });
        expect(named("Kevin")).toMatchObject({ last_name: "O'Brien, Jr." });
      });
    });
  });
}
