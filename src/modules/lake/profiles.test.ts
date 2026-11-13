// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DuckDbFileLake } from "./duckdb-file-lake";
import { fixtureDir } from "./fixtures";
import {
  applyProfile,
  builtinProfiles,
  getBuiltinProfile,
  readOptionsFor,
  sourceProfileSchema,
  validateAgainstSchema,
  type ReadOverrides,
  type SourceProfile,
} from "./profiles";
import type { LakeColumn } from "./types";

const employeeProfile: SourceProfile = {
  name: "test-employee",
  table: "employee",
  keyColumns: ["id"],
  watermarkColumn: "_fivetran_synced",
  softDeleteColumn: "_fivetran_deleted",
  entity: "employee",
  columnMap: {
    id: "bamboo_id",
    first_name: "first_name",
    work_email: "work_email",
  },
};

describe("sourceProfileSchema", () => {
  it("accepts a complete profile and one with only the required parts", () => {
    expect(sourceProfileSchema.parse(employeeProfile)).toEqual(employeeProfile);

    const minimal = {
      name: "m",
      table: "t",
      keyColumns: ["k"],
      entity: "goal",
      columnMap: { k: "goal_id" },
    };
    expect(sourceProfileSchema.parse(minimal)).toEqual(minimal);
  });

  it.each([
    ["no key columns", { keyColumns: [] }],
    ["an empty name", { name: "" }],
    ["an unknown entity", { entity: "payroll" }],
    ["an empty canonical field name", { columnMap: { id: "" } }],
    ["an unknown column type family", { columnTypes: { id: "uuid" } }],
  ])("rejects %s", (_label, override) => {
    const result = sourceProfileSchema.safeParse({
      ...employeeProfile,
      ...override,
    });

    expect(result.success).toBe(false);
  });
});

describe("applyProfile", () => {
  const row = {
    id: "101",
    first_name: "Ana",
    work_email: null,
    department: "Engineering", // not in the column map
    _fivetran_synced: "2026-01-10 10:00:00+00",
    _fivetran_deleted: false,
  };

  it("maps source columns to canonical fields and keeps the rest as extra", () => {
    const record = applyProfile(employeeProfile, row);

    expect(record).toEqual({
      entity: "employee",
      sourceId: "101",
      fields: { bamboo_id: "101", first_name: "Ana", work_email: null },
      extra: {
        department: "Engineering",
        _fivetran_synced: "2026-01-10 10:00:00+00",
        _fivetran_deleted: false,
      },
      deleted: false,
      watermark: "2026-01-10 10:00:00+00",
    });
  });

  it("builds an unambiguous source id from composite keys", () => {
    const profile: SourceProfile = {
      ...employeeProfile,
      keyColumns: ["employee_id", "goal_id"],
      columnMap: {},
    };

    const record = applyProfile(profile, { employee_id: "1|2", goal_id: 3 });

    expect(record.sourceId).toBe('["1|2","3"]');
  });

  it.each([
    [true, true],
    ["true", true],
    ["TRUE", true],
    [1, true],
    ["2026-02-01 10:00:00+00", true], // a deleted_at style column
    [false, false],
    ["false", false],
    ["0", false],
    [0, false],
    ["", false],
    [null, false],
  ])("reads soft-delete flag %j as deleted=%s", (flag, deleted) => {
    const record = applyProfile(employeeProfile, {
      ...row,
      _fivetran_deleted: flag,
    });

    expect(record.deleted).toBe(deleted);
  });

  it("never marks rows deleted when the profile has no soft-delete column", () => {
    const profile = { ...employeeProfile, softDeleteColumn: undefined };

    expect(
      applyProfile(profile, { ...row, _fivetran_deleted: true }).deleted,
    ).toBe(false);
  });

  it("has a null watermark when the profile or the row has none", () => {
    const noWatermark = { ...employeeProfile, watermarkColumn: undefined };

    expect(applyProfile(noWatermark, row).watermark).toBeNull();
    expect(
      applyProfile(employeeProfile, { ...row, _fivetran_synced: null })
        .watermark,
    ).toBeNull();
  });

  it("rejects a row whose key is empty, naming the profile and the column", () => {
    expect(() => applyProfile(employeeProfile, { ...row, id: null })).toThrow(
      /test-employee.*key column "id"/i,
    );
  });
});

describe("validateAgainstSchema", () => {
  const col = (name: string, type: string): LakeColumn => ({
    name,
    type,
    nullable: true,
  });
  const columns = [
    col("id", "BIGINT"),
    col("first_name", "VARCHAR"),
    col("work_email", "VARCHAR"),
    col("_fivetran_synced", "TIMESTAMP WITH TIME ZONE"),
    col("_fivetran_deleted", "BOOLEAN"),
    col("pronouns", "VARCHAR"), // new column nobody asked for
  ];
  const retyped = (name: string, type: string) =>
    columns.map((c) => (c.name === name ? col(name, type) : c));
  const without = (...names: string[]) =>
    columns.filter((c) => !names.includes(c.name));

  it("finds nothing wrong when every referenced column is there, and ignores new columns", () => {
    expect(validateAgainstSchema(employeeProfile, columns)).toEqual([]);
  });

  it("reports every missing column with the role it plays in the profile", () => {
    const issues = validateAgainstSchema(
      employeeProfile,
      without("id", "work_email", "_fivetran_synced", "_fivetran_deleted"),
    );

    expect(issues).toMatchObject([
      { kind: "missing_column", column: "id", role: "key" },
      { kind: "missing_column", column: "_fivetran_synced", role: "watermark" },
      {
        kind: "missing_column",
        column: "_fivetran_deleted",
        role: "soft_delete",
      },
      { kind: "missing_column", column: "work_email", role: "mapped" },
    ]);
    expect(issues[0].message).toContain('"id"');
  });

  it("suggests the existing column when only case or spacing differs", () => {
    const [issue] = validateAgainstSchema(
      {
        ...employeeProfile,
        watermarkColumn: undefined,
        softDeleteColumn: undefined,
        keyColumns: ["id"],
        columnMap: { "Review Cycle": "review_cycle" },
      },
      [...columns, col("review cycle", "VARCHAR")],
    );

    expect(issue).toMatchObject({
      kind: "missing_column",
      column: "Review Cycle",
      suggestion: "review cycle",
    });
    expect(issue.message).toContain('"review cycle"');
  });

  it("flags a watermark that cannot be ordered as time or number", () => {
    const issues = validateAgainstSchema(
      employeeProfile,
      retyped("_fivetran_synced", "VARCHAR"),
    );

    expect(issues).toMatchObject([
      {
        kind: "type_mismatch",
        column: "_fivetran_synced",
        actual: "VARCHAR",
        expected: ["number", "date", "timestamp"],
      },
    ]);
  });

  it("flags a column whose type left the family the profile declares (schema drift)", () => {
    const profile: SourceProfile = {
      ...employeeProfile,
      columnTypes: { id: "number" },
    };

    const issues = validateAgainstSchema(profile, retyped("id", "VARCHAR"));

    expect(issues).toMatchObject([
      {
        kind: "type_mismatch",
        column: "id",
        expected: ["number"],
        actual: "VARCHAR",
      },
    ]);
    expect(issues[0].message).toMatch(/"id".*VARCHAR.*expects number/);
  });

  it.each([
    ["INTEGER", "number"],
    ["DECIMAL(10,2)", "number"],
    ["INT64", "number"],
    ["BOOLEAN", "boolean"],
    ["BOOL", "boolean"],
    ["DATE", "date"],
    ["TIMESTAMP", "timestamp"],
    ["TIMESTAMP WITH TIME ZONE", "timestamp"],
    ["DATETIME", "timestamp"],
    ["VARCHAR", "string"],
    ["STRING", "string"],
  ] as const)("understands the type name %s as %s", (type, family) => {
    const profile: SourceProfile = {
      ...employeeProfile,
      columnTypes: { id: family },
    };

    expect(validateAgainstSchema(profile, retyped("id", type))).toEqual([]);
  });
});

describe("readOptionsFor", () => {
  it("starts from the profile's keys and watermark and adds the caller's options", () => {
    expect(
      readOptionsFor(employeeProfile, { since: "2026-01-10", batchSize: 50 }),
    ).toStrictEqual({
      keyColumns: ["id"],
      watermarkColumn: "_fivetran_synced",
      since: "2026-01-10",
      batchSize: 50,
    });
  });

  it("ignores options that are explicitly undefined instead of wiping anything", () => {
    expect(
      readOptionsFor(employeeProfile, {
        since: undefined,
        batchSize: undefined,
        columns: undefined,
      }),
    ).toStrictEqual({
      keyColumns: ["id"],
      watermarkColumn: "_fivetran_synced",
    });
  });

  it("never lets the caller replace the profile's keys or watermark", () => {
    // Not allowed by the types; this is what a loosely typed caller could do.
    const sneaky = {
      keyColumns: undefined,
      watermarkColumn: "other",
      since: "x",
    } as unknown as Parameters<typeof readOptionsFor>[1];

    expect(readOptionsFor(employeeProfile, sneaky)).toStrictEqual({
      keyColumns: ["id"],
      watermarkColumn: "_fivetran_synced",
      since: "x",
    });
  });
});

/** Which fixture lake each built-in profile is exercised against. */
const scenarioFor = (profile: SourceProfile) =>
  profile.name.startsWith("fivetran-")
    ? "initial"
    : profile.name.startsWith("airbyte-")
      ? "airbyte"
      : "bamboo-reports";

async function readAll(
  scenario: string,
  profile: SourceProfile,
  overrides: ReadOverrides = {},
) {
  const lake = await DuckDbFileLake.open(fixtureDir(scenario));
  try {
    const records = [];
    for await (const batch of lake.readBatches(
      profile.table,
      readOptionsFor(profile, overrides),
    )) {
      records.push(...batch.rows.map((row) => applyProfile(profile, row)));
    }
    return records;
  } finally {
    await lake.close();
  }
}

describe("built-in profiles", () => {
  it("ships Fivetran, Airbyte and Bamboo report profiles, each valid and uniquely named", () => {
    expect(builtinProfiles.map((p) => p.name)).toEqual([
      "fivetran-bamboohr-employee",
      "fivetran-bamboohr-goal",
      "fivetran-bamboohr-employee-goal",
      "fivetran-bamboohr-milestone",
      "airbyte-bamboohr-employees",
      "bamboo-employee-performance",
      "bamboo-feedback-status",
      "bamboo-goal-status",
      "bamboo-assessment-progress",
    ]);
    for (const profile of builtinProfiles) {
      expect(sourceProfileSchema.parse(profile)).toEqual(profile);
    }
  });

  it("looks profiles up by name", () => {
    expect(getBuiltinProfile("bamboo-employee-performance")).toMatchObject({
      table: "employee-performance",
      entity: "assessment",
    });
    expect(getBuiltinProfile("nope")).toBeUndefined();
  });

  it.each(builtinProfiles.map((p) => [p.name, p] as const))(
    "%s fits the columns of its fixture table",
    async (_name, profile) => {
      const lake = await DuckDbFileLake.open(fixtureDir(scenarioFor(profile)));

      const issues = validateAgainstSchema(
        profile,
        await lake.describeTable(profile.table),
      );

      expect(issues).toEqual([]);
      await lake.close();
    },
  );

  it("fivetran employee: tracks _fivetran_synced and reads soft deletes from _fivetran_deleted", async () => {
    const profile = getBuiltinProfile("fivetran-bamboohr-employee")!;

    const records = await readAll("delta-1", profile, {
      since: "2026-02-10T10:00:00Z",
    });

    expect(records.map((r) => [r.sourceId, r.deleted])).toEqual([
      ["102", false],
      ["103", true],
      ["106", false],
    ]);
    expect(records[0]).toMatchObject({
      entity: "employee",
      fields: {
        bamboo_id: "102",
        first_name: "Beto",
        job_title: "Staff Engineer",
      },
    });
    expect(records[0].watermark).toMatch(/^2026-02-10 10:00:00/);
  });

  it("fivetran link tables use a composite key", async () => {
    const profile = getBuiltinProfile("fivetran-bamboohr-employee-goal")!;

    const records = await readAll("initial", profile);

    expect(records.map((r) => r.sourceId)).toEqual([
      '["101","301"]',
      '["102","301"]',
      '["102","302"]',
      '["105","303"]',
    ]);
  });

  it("airbyte employees: maps the directory fields and tracks _airbyte_extracted_at", async () => {
    const profile = getBuiltinProfile("airbyte-bamboohr-employees")!;

    const records = await readAll("airbyte", profile);

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      sourceId: "101",
      fields: {
        bamboo_id: "101",
        first_name: "Ana",
        work_email: "ana.lopez@example.test",
        manager_name: "Perez, Beto",
      },
      deleted: false,
    });
    expect(records[2].watermark).toMatch(/^2026-01-10 10:05:00/);
  });

  it("bamboo employee performance: natural key, canonical fields, custom questions kept as extra", async () => {
    const profile = getBuiltinProfile("bamboo-employee-performance")!;

    const records = await readAll("bamboo-reports", profile);

    expect(records.map((r) => r.sourceId)).toEqual([
      '["Ana Lopez","2025 Year-End"]',
      '["Beto Perez","2025 Year-End"]',
      '["Carla Gomez","2025 Year-End"]',
    ]);
    expect(records[0]).toMatchObject({
      entity: "assessment",
      fields: {
        employee_name: "Ana Lopez",
        review_cycle: "2025 Year-End",
        manager_name: "Perez, Beto",
        self_feels_valued: "Highly valued",
        manager_engagement: "Highly engaged",
      },
      extra: { "Custom: Collaboration (1-5)": "5" },
      watermark: null,
      deleted: false,
    });
    // Carla's manager assessment is still pending.
    expect(records[2].fields.manager_completed_on).toBeNull();
  });

  it("the other bamboo reports map to feedback, goal and assessment records", async () => {
    const feedback = await readAll(
      "bamboo-reports",
      getBuiltinProfile("bamboo-feedback-status")!,
    );
    const goals = await readAll(
      "bamboo-reports",
      getBuiltinProfile("bamboo-goal-status")!,
    );
    const progress = await readAll(
      "bamboo-reports",
      getBuiltinProfile("bamboo-assessment-progress")!,
    );

    expect(feedback).toHaveLength(3);
    expect(feedback[1]).toMatchObject({
      entity: "feedback",
      fields: {
        employee_name: "Ana Lopez",
        direction: "Receiving",
        counterpart_name: "Diego Fernandez",
        status: "Past Due",
        completed_on: null,
      },
    });
    expect(goals[0]).toMatchObject({
      entity: "goal",
      fields: { title: "Ship onboarding revamp", status: "In Progress" },
    });
    expect(progress[2]).toMatchObject({
      entity: "assessment",
      fields: { self_status: "Not Started", manager_status: "Not Started" },
    });
  });
});

describe("profiles against a drifted or damaged lake", () => {
  it("a new column is not a problem; a pinned column changing type is", async () => {
    const lake = await DuckDbFileLake.open(fixtureDir("schema-drift"));
    const columns = await lake.describeTable("employee");
    const profile = getBuiltinProfile("fivetran-bamboohr-employee")!;

    expect(validateAgainstSchema(profile, columns)).toEqual([]);
    expect(
      validateAgainstSchema(
        { ...profile, columnTypes: { employee_number: "number" } },
        columns,
      ),
    ).toMatchObject([
      {
        kind: "type_mismatch",
        column: "employee_number",
        actual: "VARCHAR",
      },
    ]);
    await lake.close();
  });

  it("an uploaded report missing a column is reported with a clear message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lake-profile-test-"));
    try {
      await writeFile(
        join(dir, "employee-performance.csv"),
        "Employee,Reporting To,Department,review cycle\nAna Lopez,Beto,Eng,2025\n",
      );
      const lake = await DuckDbFileLake.open(dir);
      const profile = getBuiltinProfile("bamboo-employee-performance")!;

      const issues = validateAgainstSchema(
        profile,
        await lake.describeTable(profile.table),
      );

      expect(issues[0]).toMatchObject({
        kind: "missing_column",
        column: "Review Cycle",
        role: "key",
        suggestion: "review cycle",
      });
      expect(issues[0].message).toBe(
        'Column "Review Cycle" (key column of profile "bamboo-employee-performance") is missing from table "employee-performance"; did you mean "review cycle"?',
      );
      expect(issues.map((i) => i.column)).toContain("Self: Feels Valued");
      await lake.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
