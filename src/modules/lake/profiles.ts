import { z } from "zod";
import type { JsonValue, LakeColumn, LakeRow, ReadOptions } from "./types";

/** Canonical entities a source table can feed. */
export const PROFILE_ENTITIES = [
  "employee",
  "job_history",
  "goal",
  "assessment",
  "feedback",
] as const;
export type ProfileEntity = (typeof PROFILE_ENTITIES)[number];

/** Coarse type families, independent of how each lake names its types. */
export const TYPE_FAMILIES = [
  "string",
  "number",
  "boolean",
  "date",
  "timestamp",
] as const;
export type TypeFamily = (typeof TYPE_FAMILIES)[number];

const name = z.string().min(1);

/**
 * How one lake table (or uploaded file) maps onto a canonical entity.
 * Profiles live in configuration: the built-in ones cover Fivetran, Airbyte
 * and Bamboo's standard report exports, and users can add their own.
 */
export const sourceProfileSchema = z.object({
  name,
  /** Lake table name (for a file: the file name without extension). */
  table: name,
  /** Columns that identify a row in the source. */
  keyColumns: z.array(name).min(1),
  /** Change-tracking column for incremental reads (e.g. _fivetran_synced). */
  watermarkColumn: name.optional(),
  /** Flag column: a truthy value means the row was deleted at the source. */
  softDeleteColumn: name.optional(),
  entity: z.enum(PROFILE_ENTITIES),
  /** Source column -> canonical field name. */
  columnMap: z.record(name, name),
  /** Optional expected type family per source column, to detect drift. */
  columnTypes: z.record(name, z.enum(TYPE_FAMILIES)).optional(),
});
export type SourceProfile = z.infer<typeof sourceProfileSchema>;

/** A lake row seen through a profile. */
export interface CanonicalRecord {
  entity: ProfileEntity;
  /**
   * Stable id of the row in the source: the key value as text, or for
   * composite keys a JSON array of the values (unambiguous whatever they hold).
   */
  sourceId: string;
  /** Canonical field name -> value, for the columns the profile maps. */
  fields: Record<string, JsonValue>;
  /** Every other column, untouched, so nothing is lost on import. */
  extra: Record<string, JsonValue>;
  deleted: boolean;
  watermark: string | null;
}

const FALSE_FLAGS = new Set(["", "false", "f", "0", "no", "n"]);

/** true/1/"yes"... or any other non-empty value (a deleted_at timestamp). */
function isDeleted(flag: JsonValue | undefined): boolean {
  if (flag === null || flag === undefined) return false;
  if (typeof flag === "boolean") return flag;
  if (typeof flag === "number") return flag !== 0;
  if (typeof flag === "string") {
    return !FALSE_FLAGS.has(flag.trim().toLowerCase());
  }
  return true;
}

export function applyProfile(
  profile: SourceProfile,
  row: LakeRow,
): CanonicalRecord {
  const keyValues = profile.keyColumns.map((column) => {
    const value = row[column];
    if (value === null || value === undefined) {
      throw new Error(
        `Profile "${profile.name}": key column "${column}" is empty in the row`,
      );
    }
    return String(value);
  });

  const fields: Record<string, JsonValue> = {};
  const extra: Record<string, JsonValue> = {};
  for (const [column, value] of Object.entries(row)) {
    const canonical = profile.columnMap[column];
    if (canonical) fields[canonical] = value;
    else extra[column] = value;
  }

  const watermark = profile.watermarkColumn
    ? row[profile.watermarkColumn]
    : null;
  return {
    entity: profile.entity,
    sourceId: keyValues.length === 1 ? keyValues[0] : JSON.stringify(keyValues),
    fields,
    extra,
    deleted: profile.softDeleteColumn
      ? isDeleted(row[profile.softDeleteColumn])
      : false,
    watermark:
      watermark === null || watermark === undefined ? null : String(watermark),
  };
}

// --- Validation against the schema the lake actually has -------------------

/** Why a profile needs a column. */
export type ColumnRole = "key" | "watermark" | "soft_delete" | "mapped";

export type ProfileIssue =
  | {
      kind: "missing_column";
      column: string;
      role: ColumnRole;
      /** An existing column that differs only in case or spacing. */
      suggestion?: string;
      message: string;
    }
  | {
      kind: "type_mismatch";
      column: string;
      expected: TypeFamily[];
      /** Type name as the lake reports it. */
      actual: string;
      message: string;
    };

/** Watermarks must be orderable: time or number. */
const WATERMARK_FAMILIES: TypeFamily[] = ["number", "date", "timestamp"];

/** Family of a lake type name (DuckDB, BigQuery, Postgres spellings), if known. */
export function typeFamily(type: string): TypeFamily | null {
  const t = type.trim().toUpperCase();
  if (/^(TIMESTAMP|DATETIME)/.test(t)) return "timestamp";
  if (t === "DATE") return "date";
  if (/^BOOL(EAN)?$/.test(t)) return "boolean";
  if (
    /^(U?(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT)|INT\d+|FLOAT\d*|DOUBLE|REAL|DECIMAL|NUMERIC|BIGNUMERIC)\b/.test(
      t,
    )
  ) {
    return "number";
  }
  if (/^(VARCHAR|STRING|TEXT|CHAR|BPCHAR)\b/.test(t)) return "string";
  return null;
}

const looseName = (column: string) =>
  column
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim();

/**
 * Check a lake table's columns against a profile: columns the profile needs
 * that are missing, and columns whose type no longer fits (the watermark must
 * be orderable; `columnTypes` pins families to detect drift). Columns the
 * profile does not mention, such as newly added ones, are not issues.
 */
export function validateAgainstSchema(
  profile: SourceProfile,
  columns: LakeColumn[],
): ProfileIssue[] {
  const byName = new Map(columns.map((c) => [c.name, c]));

  const roles = new Map<string, ColumnRole>();
  const need = (column: string | undefined, role: ColumnRole) => {
    if (column && !roles.has(column)) roles.set(column, role);
  };
  profile.keyColumns.forEach((column) => need(column, "key"));
  need(profile.watermarkColumn, "watermark");
  need(profile.softDeleteColumn, "soft_delete");
  Object.keys(profile.columnMap).forEach((column) => need(column, "mapped"));

  const issues: ProfileIssue[] = [];
  for (const [column, role] of roles) {
    const found = byName.get(column);
    if (!found) {
      const suggestion = columns.find(
        (c) => looseName(c.name) === looseName(column),
      )?.name;
      issues.push({
        kind: "missing_column",
        column,
        role,
        suggestion,
        message:
          `Column "${column}" (${role.replace("_", "-")} column of profile "${profile.name}") ` +
          `is missing from table "${profile.table}"` +
          (suggestion ? `; did you mean "${suggestion}"?` : ""),
      });
      continue;
    }
    const declared = profile.columnTypes?.[column];
    const expected = declared
      ? [declared]
      : role === "watermark"
        ? WATERMARK_FAMILIES
        : undefined;
    const family = typeFamily(found.type);
    if (expected && (!family || !expected.includes(family))) {
      issues.push({
        kind: "type_mismatch",
        column,
        expected,
        actual: found.type,
        message: `Column "${column}" has type ${found.type} but profile "${profile.name}" expects ${expected.join(" or ")}`,
      });
    }
  }
  return issues;
}

// --- Reading through a profile ---------------------------------------------

/**
 * `readBatches` options for a profile: its keys and watermark, plus whatever
 * the caller adds (`since`, `batchSize`). All columns are read on purpose, so
 * unmapped ones (Bamboo's custom questions) land in `CanonicalRecord.extra`.
 */
export function readOptionsFor(
  profile: SourceProfile,
  overrides: ReadOverrides = {},
): ReadOptions {
  const options: ReadOptions = { keyColumns: profile.keyColumns };
  if (profile.watermarkColumn)
    options.watermarkColumn = profile.watermarkColumn;
  // Only what the caller really set: an explicit `undefined` must not wipe a
  // default, and the profile's keys and watermark are not overridable.
  if (overrides.since !== undefined) options.since = overrides.since;
  if (overrides.batchSize !== undefined)
    options.batchSize = overrides.batchSize;
  if (overrides.columns !== undefined) options.columns = overrides.columns;
  return options;
}

/** What a caller may add to a profile's read options. */
export type ReadOverrides = Pick<
  ReadOptions,
  "since" | "batchSize" | "columns"
>;

// --- Built-in profiles -----------------------------------------------------
//
// Column names are the expected shape of each tool's output; real lakes can
// differ (Fivetran adds account-specific employee fields, Airbyte destinations
// may lower-case names). Run `validateAgainstSchema` before ingesting and
// override a profile in configuration where a lake deviates.

const fivetran = {
  watermarkColumn: "_fivetran_synced",
  softDeleteColumn: "_fivetran_deleted",
} as const;

export const builtinProfiles: SourceProfile[] = [
  {
    name: "fivetran-bamboohr-employee",
    table: "employee",
    keyColumns: ["id"],
    ...fivetran,
    entity: "employee",
    columnMap: {
      id: "bamboo_id",
      employee_number: "employee_number",
      first_name: "first_name",
      last_name: "last_name",
      work_email: "work_email",
      department: "department",
      job_title: "job_title",
      hire_date: "hire_date",
      last_changed: "last_changed_at",
    },
    columnTypes: { id: "number" },
  },
  {
    name: "fivetran-bamboohr-goal",
    table: "goal",
    keyColumns: ["id"],
    ...fivetran,
    entity: "goal",
    columnMap: {
      id: "bamboo_goal_id",
      title: "title",
      percent_complete: "percent_complete",
      status: "status",
      due_date: "due_date",
      completed_at: "completed_at",
    },
    columnTypes: { id: "number" },
  },
  {
    // Link table: which employee owns which goal.
    name: "fivetran-bamboohr-employee-goal",
    table: "employee_goal",
    keyColumns: ["employee_id", "goal_id"],
    ...fivetran,
    entity: "goal",
    columnMap: {
      employee_id: "owner_bamboo_id",
      goal_id: "bamboo_goal_id",
    },
  },
  {
    name: "fivetran-bamboohr-milestone",
    table: "milestone",
    keyColumns: ["id"],
    ...fivetran,
    entity: "goal",
    columnMap: {
      id: "bamboo_milestone_id",
      goal_id: "bamboo_goal_id",
      title: "title",
      completed_date: "completed_on",
    },
  },
  {
    name: "airbyte-bamboohr-employees",
    table: "employees",
    keyColumns: ["id"],
    watermarkColumn: "_airbyte_extracted_at",
    entity: "employee",
    columnMap: {
      id: "bamboo_id",
      firstName: "first_name",
      lastName: "last_name",
      workEmail: "work_email",
      jobTitle: "job_title",
      department: "department",
      division: "division",
      location: "location",
      // The directory only has the supervisor's name, not an id.
      supervisor: "manager_name",
    },
  },
  // Bamboo standard report exports (Reports > Performance and Culture). Headers
  // are the ones in fixtures/bamboo-reports (see fixtures/README). The reports
  // carry no ids (docs/research/02) and identify people by name only, so rows
  // are keyed by natural columns, and they are full snapshots: no watermark.
  // Manager and Department are the CURRENT ones at export time, so they are
  // used in a key only where nothing else tells namesakes apart. Columns the
  // profile does not map land in `extra` under their exact header.
  {
    name: "bamboo-employee-performance",
    table: "employee-performance",
    // Assessment Date keeps two employees with the same name apart in a cycle.
    keyColumns: ["Employee Name", "Review Cycle", "Assessment Date"],
    entity: "assessment",
    // The question columns are deliberately not mapped: their headers embed
    // the question text ("Employee Q1: How well does <company> recognize my
    // value?") and the company's custom questions, so they vary per account.
    // They stay in `extra`, keyed by header ("Employee Q1: ...",
    // "Manager Custom Q2: ...").
    columnMap: {
      "Employee Name": "employee_name",
      Manager: "manager_name",
      Department: "department",
      "Review Cycle": "review_cycle",
      "Assessment Date": "assessment_date",
    },
  },
  {
    name: "bamboo-feedback-status",
    table: "feedback-status",
    keyColumns: ["Employee Name", "Receiving Feedback From", "Review Cycle"],
    entity: "feedback",
    columnMap: {
      "Employee Name": "employee_name",
      "Receiving Feedback From": "reviewer_name",
      "Date Completed": "completed_on",
      "Due Date": "due_date",
      "Review Cycle": "review_cycle",
    },
  },
  {
    name: "bamboo-goal-status",
    table: "goal-status",
    // People without goals appear as one row with status "No Goals Set" and an
    // empty Goal and Due Date: they have no key, so applyProfile rejects them.
    // The consumer drops rows with an empty Goal before applying the profile.
    keyColumns: ["Employee Name", "Goal", "Due Date"],
    entity: "goal",
    columnMap: {
      "Employee Name": "employee_name",
      Manager: "manager_name",
      Department: "department",
      Goal: "title",
      "Due Date": "due_date",
      // Text such as "33%".
      Progress: "percent_complete",
      Status: "status",
      "Last Comment": "last_comment",
    },
  },
  {
    name: "bamboo-assessment-progress",
    table: "assessment-progress",
    // Department keeps namesakes apart (Manager can be empty, so it cannot be
    // part of a key).
    keyColumns: ["Employee Name", "Review Cycle", "Department"],
    entity: "assessment",
    columnMap: {
      "Employee Name": "employee_name",
      Manager: "manager_name",
      Department: "department",
      "Review Cycle": "review_cycle",
      // Overall state of the assessment: Complete, In Progress or Not Started.
      Assessed: "assessed",
      "Self Status": "self_status",
      "Manager Status": "manager_status",
      "Follow-up Notes": "follow_up_notes",
    },
  },
];

export function getBuiltinProfile(name: string): SourceProfile | undefined {
  return builtinProfiles.find((profile) => profile.name === name);
}
