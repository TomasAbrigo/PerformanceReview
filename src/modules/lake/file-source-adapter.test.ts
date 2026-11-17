// @vitest-environment node
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtractedRecord } from "@/modules/ingest/types";
import type { IngestReject } from "@/db/schema";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { builtinSourceSystem, FileSourceAdapter } from "./file-source-adapter";
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
    expect(records).toHaveLength(119);
    expect(new Set(records.map((r) => r.sourceId)).size).toBe(119);
    const id = JSON.stringify([
      "Adrián Bustos",
      "Evaluación semestral 2024-H1",
      "2024-05-16",
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
        review_cycle: "Evaluación semestral 2024-H1",
        assessment_date: "2024-05-16",
      },
      deleted: false,
      watermark: null,
      // Exactly as the file has it, under the original headers.
      raw: {
        "Employee Name": "Adrián Bustos",
        "Assessment Date": "2024-05-16",
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
    expect(paged.records.length + paged.rejected.length).toBe(132);
  });

  it("reports rows the profile rejects instead of throwing (people without goals)", async () => {
    const adapter = new FileSourceAdapter(
      profileNamed("bamboo-goal-status"),
      await open(REPORTS),
    );

    const { records, rejected } = await collect(adapter);

    // 132 rows: 127 goals plus 5 people with "No Goals Set" and no Goal.
    expect(records).toHaveLength(127);
    expect(rejected).toHaveLength(5);
    for (const reject of rejected) {
      expect(reject.sourceId).toBeNull();
      expect(reject.reason).toContain('key column "Goal" is empty');
      // The reason says which row it was.
      expect(reject.reason).toMatch(/Employee Name="[^"]+"/);
      // And the same, structured, so the UI can word it in its own language.
      expect(reject).toMatchObject({
        code: "empty_key",
        column: "Goal",
        values: { Goal: null, "Due Date": null },
      });
      expect(reject.values?.["Employee Name"]).toEqual(expect.any(String));
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

    const adapter = new FileSourceAdapter(
      profile,
      lake,
      "employee-performance",
    );

    expect(adapter.entities).toEqual(["assessment"]);
    expect((await collect(adapter)).records).toHaveLength(119);
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

  it("stops at the next row once the signal is aborted", async () => {
    const adapter = new FileSourceAdapter(
      profileNamed("bamboo-employee-performance"),
      await open(REPORTS),
    );
    const controller = new AbortController();
    const seen: string[] = [];

    const read = async () => {
      for await (const record of adapter.extract(
        { signal: controller.signal },
        "assessment",
      )) {
        seen.push(record.sourceId);
        if (seen.length === 3) controller.abort(new Error("terminated"));
      }
    };

    await expect(read()).rejects.toThrow("terminated");
    expect(seen).toHaveLength(3);
  });

  it("refuses to extract an entity the profile does not feed", async () => {
    const adapter = new FileSourceAdapter(
      profileNamed("bamboo-employee-performance"),
      await open(REPORTS),
    );

    expect(() => adapter.extract({}, "goal")).toThrow(/assessment/);
  });
});

describe("source system", () => {
  it("is the lake unless the caller says otherwise, whatever the profile is called", async () => {
    const lake = await open(REPORTS);
    const custom: SourceProfile = {
      ...profileNamed("bamboo-goal-status"),
      name: "bamboo-mio",
    };

    expect(new FileSourceAdapter(custom, lake).source).toBe("lake");
    expect(
      new FileSourceAdapter(profileNamed("bamboo-goal-status"), lake).source,
    ).toBe("lake");
  });

  it("takes the source system the caller decided", async () => {
    const adapter = new FileSourceAdapter(
      profileNamed("bamboo-goal-status"),
      await open(REPORTS),
      undefined,
      { source: "bamboo_export" },
    );

    expect(adapter.source).toBe("bamboo_export");
  });

  it("built-in Bamboo report profiles are bamboo_export, other built-ins come from the lake", () => {
    expect(builtinSourceSystem(profileNamed("bamboo-goal-status"))).toBe(
      "bamboo_export",
    );
    expect(builtinSourceSystem(profileNamed("fivetran-bamboohr-goal"))).toBe(
      "lake",
    );
    expect(
      builtinSourceSystem(profileNamed("airbyte-bamboohr-employees")),
    ).toBe("lake");
  });
});

describe("FileSourceAdapter: Bamboo's real report shapes (#83)", () => {
  it("joins each period row of the grouped status export with its person row", async () => {
    const profile = profileNamed("bamboo-assessment-status");
    const adapter = new FileSourceAdapter(profile, await open(REPORTS));

    const { records, rejected } = await collect(adapter);

    expect(rejected).toEqual([]);
    expect(records.length).toBeGreaterThan(100);
    expect(new Set(records.map((r) => r.sourceId)).size).toBe(records.length);
    const [first] = records;
    const payload = first.payload as {
      format: string;
      fields: Record<string, unknown>;
    };
    expect(payload.format).toBe("assessment_status");
    expect(payload.fields).toMatchObject({
      employee_name: "Adrián Bustos",
      employee_number: "10033",
      period: "04/15/2024 - 09/28/2024",
      self_status: "Completado",
      manager_status: "Completed by Silvana Molina",
    });
    expect(JSON.parse(first.sourceId)).toEqual(["10033", "2024-04-15"]);
  });

  it("hands raw report rows over with their format and custom question pairs", async () => {
    const profile = profileNamed("bamboo-assessments-report");
    const adapter = new FileSourceAdapter(profile, await open(REPORTS));

    const { records, rejected } = await collect(adapter);

    expect(rejected).toEqual([]);
    expect(new Set(records.map((r) => r.sourceId)).size).toBe(records.length);
    expect(JSON.parse(records[0].sourceId)[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const payload = records[0].payload as {
      format: string;
      fields: Record<string, unknown>;
      customQuestions: unknown[];
    };
    expect(payload.format).toBe("assessments_report");
    expect(payload.customQuestions).toHaveLength(6);
    expect(Object.keys(payload.fields)).toEqual(
      expect.arrayContaining([
        "employee_bamboo_id",
        "period_start",
        "work_email",
        "manager_name",
      ]),
    );
  });
});

describe("splitGroupHeader", () => {
  it("takes the trailing number as the employee number", async () => {
    const { splitGroupHeader } = await import("./file-source-adapter");
    expect(splitGroupHeader("Ana María Pérez 1042")).toEqual({
      name: "Ana María Pérez",
      employeeNumber: "1042",
    });
    expect(splitGroupHeader("Sin Número")).toEqual({
      name: "Sin Número",
      employeeNumber: null,
    });
  });
});

describe("raw report keys without an EEID (#83)", () => {
  it("keys the row by work email, else name, instead of rejecting it", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(resolve(tmpdir(), "raw-key-"));
    await writeFile(
      resolve(dir, "assessments-report.csv"),
      [
        "EEID,Review Period Start,Work Email,Employee Name,Self Assessment Completed Date,Manager Assessment Completed Date,Manager At Time Of Assessment",
        ",03/29/2024,Ana@Example.invalid,,,,",
        ",03/29/2024,,Bruno Paz,,,",
        ",03/29/2024,,,,,",
      ].join("\n") + "\n",
    );
    const profile = profileNamed("bamboo-assessments-report");
    const { records, rejected } = await collect(
      new FileSourceAdapter(profile, await open(dir)),
    );
    expect(records.map((r) => JSON.parse(r.sourceId))).toEqual([
      ["email:ana@example.invalid", "2024-03-29"],
      ["name:Bruno Paz", "2024-03-29"],
    ]);
    expect(rejected).toHaveLength(1);
  });
});
