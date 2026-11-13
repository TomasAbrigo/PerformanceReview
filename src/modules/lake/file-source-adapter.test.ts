// @vitest-environment node
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtractedRecord } from "@/modules/ingest/types";
import type { IngestReject } from "@/db/schema";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { FileSourceAdapter, sourceSystemFor } from "./file-source-adapter";
import { fixtureDir } from "./fixtures";
import { getBuiltinProfile, type SourceProfile } from "./profiles";

/** Synthetic Bamboo report exports (82 lines of CSV, some cells span lines). */
const REPORTS = resolve("fixtures/bamboo-reports/small");

const lakes: DuckDbFileLake[] = [];
async function open(dir: string) {
  const lake = await DuckDbFileLake.open(dir);
  lakes.push(lake);
  return lake;
}
afterEach(async () => {
  await Promise.all(lakes.splice(0).map((lake) => lake.close()));
});

function profileNamed(name: string): SourceProfile {
  const profile = getBuiltinProfile(name);
  if (!profile) throw new Error(`no built-in profile ${name}`);
  return profile;
}

async function collect(adapter: FileSourceAdapter) {
  const records: ExtractedRecord[] = [];
  const rejected: IngestReject[] = [];
  const ctx = { onReject: (reject: IngestReject) => rejected.push(reject) };
  for await (const record of adapter.extract(ctx, adapter.entities[0])) {
    records.push(record);
  }
  return { records, rejected };
}

async function collectWithoutRejectHandler(adapter: FileSourceAdapter) {
  const records: ExtractedRecord[] = [];
  for await (const record of adapter.extract({}, adapter.entities[0])) {
    records.push(record);
  }
  return records;
}

describe("FileSourceAdapter", () => {
  it("yields one record per row, with the profile's composite sourceId", async () => {
    const profile = profileNamed("bamboo-employee-performance");
    const adapter = new FileSourceAdapter(profile, await open(REPORTS));

    const { records, rejected } = await collect(adapter);

    expect(rejected).toEqual([]);
    expect(records).toHaveLength(69);
    expect(new Set(records.map((r) => r.sourceId)).size).toBe(69);
    const id = JSON.stringify([
      "Adrián Bustos",
      "Evaluación de desempeño 2023",
      "2023-12-01",
    ]);
    expect(records.map((r) => r.sourceId)).toContain(id);
    expect(records[0].extractedAt).toBeInstanceOf(Date);
  });

  it("puts fields, extra, deleted, watermark and the raw row in the payload", async () => {
    const adapter = new FileSourceAdapter(
      profileNamed("bamboo-employee-performance"),
      await open(REPORTS),
    );

    const { records } = await collect(adapter);
    const adrian = records.find((r) => r.sourceId.startsWith('["Adrián B'));

    expect(adrian?.payload).toMatchObject({
      fields: {
        employee_name: "Adrián Bustos",
        manager_name: "Silvana Molina",
        department: "Ingeniería",
        review_cycle: "Evaluación de desempeño 2023",
        assessment_date: "2023-12-01",
      },
      deleted: false,
      watermark: null,
      // Exactly as the file has it, under the original headers.
      raw: {
        "Employee Name": "Adrián Bustos",
        "Assessment Date": "2023-12-01",
      },
    });
    const payload = adrian?.payload as {
      extra: Record<string, unknown>;
      raw: Record<string, unknown>;
    };
    // Unmapped columns (the questions) survive under their full header.
    expect(
      Object.keys(payload.extra).some((c) => c.startsWith("Employee Q1:")),
    ).toBe(true);
    expect(payload.extra).not.toHaveProperty("Employee Name");
    expect(Object.keys(payload.raw)).toEqual(
      expect.arrayContaining(["Employee Name", "Review Cycle"]),
    );
  });

  it("yields every row exactly once whatever the batch size", async () => {
    const lake = await open(REPORTS);
    const profile = profileNamed("bamboo-goal-status");

    const whole = await collect(new FileSourceAdapter(profile, lake));
    const paged = await collect(
      new FileSourceAdapter(profile, lake, undefined, { batchSize: 7 }),
    );

    expect(paged.records.map((r) => r.sourceId)).toEqual(
      whole.records.map((r) => r.sourceId),
    );
    expect(paged.records.length + paged.rejected.length).toBe(119);
  });

  it("reports rows the profile rejects instead of throwing (people without goals)", async () => {
    const adapter = new FileSourceAdapter(
      profileNamed("bamboo-goal-status"),
      await open(REPORTS),
    );

    const { records, rejected } = await collect(adapter);

    // 119 rows: 117 goals plus 2 people with "No Goals Set" and no Goal.
    expect(records).toHaveLength(117);
    expect(rejected).toHaveLength(2);
    for (const reject of rejected) {
      expect(reject.sourceId).toBeNull();
      expect(reject.reason).toContain('key column "Goal" is empty');
      // The reason says which row it was.
      expect(reject.reason).toMatch(/Employee Name="[^"]+"/);
    }
  });

  it("carries the watermark and the soft-delete flag of lake tables", async () => {
    const profile = profileNamed("fivetran-bamboohr-employee");
    const adapter = new FileSourceAdapter(
      profile,
      await open(fixtureDir("delta-1")),
    );

    const { records } = await collect(adapter);

    expect(records.length).toBeGreaterThan(0);
    for (const { payload } of records) {
      expect((payload as { watermark: unknown }).watermark).toEqual(
        expect.any(String),
      );
    }
    expect(
      records.some((r) => (r.payload as { deleted: boolean }).deleted),
    ).toBe(true);
  });

  it("reads only rows changed since the given watermark", async () => {
    const profile = profileNamed("fivetran-bamboohr-employee");
    const lake = await open(fixtureDir("delta-1"));
    const adapter = new FileSourceAdapter(profile, lake);

    const all = await collect(adapter);
    const watermarks = all.records
      .map((r) => (r.payload as { watermark: string }).watermark)
      .sort();
    const latest = watermarks[watermarks.length - 1];

    const delta: ExtractedRecord[] = [];
    for await (const record of adapter.extract({ since: latest }, "employee")) {
      delta.push(record);
    }
    expect(delta.length).toBeGreaterThan(0);
    expect(delta.length).toBeLessThan(all.records.length);
  });

  it("reads the table named by the third argument, not only the profile's", async () => {
    const profile = profileNamed("bamboo-employee-performance");
    const lake = await open(REPORTS);

    const adapter = new FileSourceAdapter(profile, lake, "employee-performance");

    expect(adapter.entities).toEqual(["assessment"]);
    expect((await collect(adapter)).records).toHaveLength(69);
    await expect(
      collect(new FileSourceAdapter(profile, lake, "nope")),
    ).rejects.toThrow('Unknown table "nope"');
  });

  it("throws a row it cannot map when nobody can take the reject", async () => {
    const adapter = new FileSourceAdapter(
      profileNamed("bamboo-goal-status"),
      await open(REPORTS),
    );

    await expect(collectWithoutRejectHandler(adapter)).rejects.toThrow(
      'key column "Goal" is empty',
    );
  });

  it("refuses to extract an entity the profile does not feed", async () => {
    const adapter = new FileSourceAdapter(
      profileNamed("bamboo-employee-performance"),
      await open(REPORTS),
    );

    expect(() => adapter.extract({}, "goal")).toThrow(/assessment/);
  });
});

describe("sourceSystemFor", () => {
  it("files from Bamboo reports are bamboo_export, other tables come from the lake", () => {
    expect(sourceSystemFor(profileNamed("bamboo-goal-status"))).toBe(
      "bamboo_export",
    );
    expect(sourceSystemFor(profileNamed("fivetran-bamboohr-goal"))).toBe(
      "lake",
    );
    expect(
      sourceSystemFor({
        name: "mi-perfil",
        table: "mi-perfil",
        keyColumns: ["id"],
        entity: "goal",
        columnMap: {},
      }),
    ).toBe("lake");
  });
});
