import { z } from "zod";
import {
  questionDimensions,
  questionRoles,
} from "@/modules/templates/constants";
import type { JsonValue, LakeColumn, LakeRow, ReadOptions } from "./types";

/** Canonical entities a source table can feed. */
export const PROFILE_ENTITIES = [
  "employee",
  "job_history",
  "goal",
  "assessment",
  "assessment_progress",
  "feedback",
  // People's file of accounts, projects, DMs and Santex leads per person.
  "org_attribute",
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

/** How a question column of a report is answered. */
export const QUESTION_KINDS = [
  "text",
  "likert",
  "letter_choice",
  // An English label among `options` (Bamboo's raw report); with a Likert
  // role (valued, retention, engagement) the role's labels instead.
  "label_choice",
] as const;
export type QuestionMappingKind = (typeof QUESTION_KINDS)[number];

/**
 * One question column of a performance report, configured instead of
 * detected from its header: which side answers it, how (free text, a 1-5
 * likert rating, a letter among `options`), the stable key its question
 * revision is found by on every import, and what it measures (`dimension`,
 * `role`: e.g. Bamboo's manager Q1 is `retention`, Q2 `engagement`).
 */
export const questionMappingSchema = z.object({
  column: name,
  side: z.enum(["self", "manager"]),
  kind: z.enum(QUESTION_KINDS),
  key: name,
  dimension: z.enum(questionDimensions).optional(),
  role: z.enum(questionRoles).optional(),
  /**
   * letter_choice: the label of A, B, C... in order. label_choice: the labels
   * a cell may hold; one starting with "Other" takes free text after it.
   */
  options: z.array(name).optional(),
});
export type QuestionMapping = z.infer<typeof questionMappingSchema>;

/**
 * A custom question pair of Bamboo's raw report: the question text is in the
 * `questionColumn` cell (it changes between cycles), the answer in
 * `answerColumn`. Each distinct (side, n, text) of a cycle is one question.
 */
export const customQuestionSchema = z.object({
  side: z.enum(["self", "manager"]),
  n: z.number().int().min(1),
  questionColumn: name,
  answerColumn: name,
});
export type CustomQuestionMapping = z.infer<typeof customQuestionSchema>;

/**
 * How the rows of a file are read (default: one record per row, the legacy
 * Bamboo reports). `assessments_report`: Bamboo's raw assessments report
 * (EEID, Review Period Start, labels, custom question pairs).
 * `assessment_status`: the Assessment Progress export grouped by person (a
 * "<name> <employee number>" row, then one row per period). `org_attributes`:
 * People's file of account / project / DM / Santex Lead per person and
 * validity, one record per row keyed by EEID and `Desde`.
 */
export const PROFILE_FORMATS = [
  "assessments_report",
  "assessment_status",
  "org_attributes",
] as const;
export type ProfileFormat = (typeof PROFILE_FORMATS)[number];

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
  /**
   * Accept a file with any columns: key columns missing from it are not an
   * issue, and a row without a value in them is keyed by its file and
   * ordinal (`row:<sha256(file sha256 + row index)>`): identical rows are
   * kept, the same file lands unchanged, and an edited file lands as a new
   * version (its old rows are not reconciled).
   * For files whose format is not defined yet.
   */
  syntheticKey: z.boolean().optional(),
  /** Change-tracking column for incremental reads (e.g. _fivetran_synced). */
  watermarkColumn: name.optional(),
  /** Flag column: a truthy value means the row was deleted at the source. */
  softDeleteColumn: name.optional(),
  entity: z.enum(PROFILE_ENTITIES),
  /** Source column -> canonical field name. */
  columnMap: z.record(name, name),
  /** Optional expected type family per source column, to detect drift. */
  columnTypes: z.record(name, z.enum(TYPE_FAMILIES)).optional(),
  /**
   * How ambiguous day/month dates ("03/04/2023") are written: month first
   * (`mdy`) or day first (`dmy`). ISO dates, and dates where a part is above
   * 12, never need it; without it an ambiguous date rejects the row.
   */
  dateFormat: z.enum(["mdy", "dmy"]).optional(),
  /**
   * Performance reports: the question columns, by exact header. Columns not
   * listed are still detected by Bamboo's header pattern ("Employee Q1: ...").
   */
  questions: z.array(questionMappingSchema).optional(),
  /**
   * The column naming the review cycle (canonical field `review_cycle`). It
   * may be empty even as part of the key: the row's date then decides its
   * semester (import-history).
   */
  cycleColumn: name.optional(),
  /** The column with the assessment date (canonical field `assessment_date`). */
  dateColumn: name.optional(),
  format: z.enum(PROFILE_FORMATS).optional(),
  /**
   * Mapped columns a file may lack (alternative headers of one field, such
   * as "Work Email" / "Correo electrónico del trabajo"): not an issue.
   */
  optionalColumns: z.array(name).optional(),
  /** Raw report: its custom question/answer column pairs. */
  customQuestions: z.array(customQuestionSchema).optional(),
  /** A superseded shape kept for old exports (shown as legacy). */
  legacy: z.boolean().optional(),
  /**
   * Org attributes file: it lists only some of the rows, so what it does not
   * mention is not dropped. Without it the file is the whole list and an
   * attribute this source wrote that is not in it is removed.
   */
  partial: z.boolean().optional(),
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

/**
 * `fallbackKey` (with `syntheticKey` profiles) is the sourceId of a row that
 * has no value in some key column: the caller hashes the row (this module is
 * also used in the browser, so it does not hash).
 */
export function applyProfile(
  profile: SourceProfile,
  row: LakeRow,
  fallbackKey?: () => string,
): CanonicalRecord {
  const keyless =
    profile.syntheticKey &&
    fallbackKey &&
    profile.keyColumns.some((c) => row[c] === null || row[c] === undefined);
  const keyValues = (keyless ? [] : profile.keyColumns).map((column) => {
    const value = row[column];
    if (
      (value === null || value === undefined) &&
      column === profile.cycleColumn
    ) {
      return "";
    }
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
    // Two headers of one field (aliases): an empty one never hides the other.
    if (canonical) {
      if (fields[canonical] == null || value != null) fields[canonical] = value;
    } else extra[column] = value;
  }
  if (profile.cycleColumn)
    fields.review_cycle = row[profile.cycleColumn] ?? null;
  if (profile.dateColumn) {
    fields.assessment_date = row[profile.dateColumn] ?? null;
  }

  const watermark = profile.watermarkColumn
    ? row[profile.watermarkColumn]
    : null;
  return {
    entity: profile.entity,
    sourceId: keyless
      ? fallbackKey()
      : keyValues.length === 1
        ? keyValues[0]
        : JSON.stringify(keyValues),
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
 *
 * `table` only words the messages: the table or file the columns came from
 * (default: the profile's own table; an uploaded file has another name).
 */
export function validateAgainstSchema(
  profile: SourceProfile,
  columns: LakeColumn[],
  table: string = profile.table,
): ProfileIssue[] {
  const byName = new Map(columns.map((c) => [c.name, c]));

  const roles = new Map<string, ColumnRole>();
  const need = (column: string | undefined, role: ColumnRole) => {
    if (column && !roles.has(column)) roles.set(column, role);
  };
  // A synthetic-key profile takes any columns: its keys are optional.
  if (!profile.syntheticKey) {
    profile.keyColumns.forEach((column) => need(column, "key"));
  }
  need(profile.watermarkColumn, "watermark");
  need(profile.softDeleteColumn, "soft_delete");
  need(profile.cycleColumn, "mapped");
  need(profile.dateColumn, "mapped");
  Object.keys(profile.columnMap).forEach((column) => need(column, "mapped"));

  const issues: ProfileIssue[] = [];
  const optional = new Set(profile.optionalColumns ?? []);
  for (const [column, role] of roles) {
    const found = byName.get(column);
    if (!found && optional.has(column)) continue;
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
          `is missing from table "${table}"` +
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
  if (profile.format === "assessment_status") options.fileOrder = true;
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

/** Bamboo's standard questions and the fixtures' custom ones (docs/research/07). */
const BAMBOO_PERFORMANCE_QUESTIONS: QuestionMapping[] = [
  [
    "self",
    "Employee",
    "q1",
    "letter_choice",
    "How well does Meridian Andina recognize my value?",
  ],
  [
    "self",
    "Employee",
    "q2",
    "letter_choice",
    "What would have the greatest impact on my ability to do my best work more often?",
  ],
  ["self", "Employee", "q3", "text", "What are some things I do well?"],
  ["self", "Employee", "q4", "text", "How could I improve?"],
  [
    "manager",
    "Manager",
    "q1",
    "letter_choice",
    "If [Employee] got a job offer elsewhere, I would...",
  ],
  [
    "manager",
    "Manager",
    "q2",
    "letter_choice",
    "How engaged is [Employee] at work?",
  ],
  [
    "manager",
    "Manager",
    "q3",
    "text",
    "What are some things [Employee] does well?",
  ],
  ["manager", "Manager", "q4", "text", "How could [Employee] improve?"],
  [
    "self",
    "Employee",
    "custom:1",
    "likert",
    "Mis objetivos del período están claros.",
  ],
  [
    "manager",
    "Manager",
    "custom:1",
    "likert",
    "Los objetivos de [Employee] para el período están claros.",
  ],
  [
    "self",
    "Employee",
    "custom:2",
    "likert",
    "Tengo las herramientas para hacer bien mi trabajo.",
  ],
  [
    "manager",
    "Manager",
    "custom:2",
    "likert",
    "[Employee] entrega resultados con la calidad esperada.",
  ],
].map(([side, who, q, kind, text]) => {
  const custom = q.startsWith("custom:");
  const n = q.replace(/\D/g, "");
  return {
    column: `${who} ${custom ? "Custom " : ""}Q${n}: ${text}`,
    side: side as QuestionMapping["side"],
    kind: kind as QuestionMappingKind,
    key: custom ? `${side}:${q}:${text.toLowerCase()}` : `${side}:${q}`,
    // What the standard manager letters measure (#57 maps them to 1-5).
    ...(side === "manager" && q === "q1" ? { role: "retention" as const } : {}),
    ...(side === "manager" && q === "q2"
      ? { role: "engagement" as const }
      : {}),
    ...(q === "q3" ? { dimension: "strengths" as const } : {}),
    ...(q === "q4" ? { dimension: "improvement" as const } : {}),
    ...(custom ? { dimension: `custom_${n}` as "custom_1" | "custom_2" } : {}),
  };
});

/** The closed and open questions of Bamboo's raw assessments report (#83). */
export const ASSESSMENTS_REPORT_QUESTIONS: QuestionMapping[] = [
  {
    column: "Employee - How well does [Company] recognize my value?",
    side: "self",
    kind: "label_choice",
    key: "self:valued",
    role: "valued",
    dimension: "valued",
  },
  {
    column: "Employee - What would help me do my best work?",
    side: "self",
    kind: "label_choice",
    key: "self:best_work",
    dimension: "best_work",
    options: [
      "Nothing, I have all I need.",
      "The company direction or purpose was better defined.",
      "Coworkers were more committed to doing great work.",
      "Work that better fits my strengths.",
      "Other",
    ],
  },
  {
    column: "Employee - What do I do well?",
    side: "self",
    kind: "text",
    key: "self:strengths",
    dimension: "strengths",
  },
  {
    column: "Employee - How could I improve?",
    side: "self",
    kind: "text",
    key: "self:improvement",
    dimension: "improvement",
  },
  {
    column: "Manager - Does [Employee] feel valued? (Performance Score)",
    side: "manager",
    kind: "label_choice",
    key: "manager:retention",
    role: "retention",
  },
  {
    column: "Manager - How engaged is [Employee]? (Engagement Score)",
    side: "manager",
    kind: "label_choice",
    key: "manager:engagement",
    role: "engagement",
  },
  {
    column: "Manager - What does [Employee] do well?",
    side: "manager",
    kind: "text",
    key: "manager:strengths",
    dimension: "strengths",
  },
  {
    column: "Manager - How could [Employee] improve?",
    side: "manager",
    kind: "text",
    key: "manager:improvement",
    dimension: "improvement",
  },
];

/** The closed columns of the raw reports (`reports:inspect --values`). */
export const CLOSED_REPORT_COLUMNS = ASSESSMENTS_REPORT_QUESTIONS.filter(
  (q) => q.kind === "label_choice",
).map((q) => q.column);

const ASSESSMENTS_REPORT_CUSTOM: CustomQuestionMapping[] = (
  ["self", "manager"] as const
).flatMap((side) =>
  [1, 2, 3].map((n) => {
    const who = side === "self" ? "Employee" : "Manager";
    return {
      side,
      n,
      questionColumn: `${who} - Custom Question ${n}`,
      answerColumn: `${who} - Custom Answer ${n}`,
    };
  }),
);

/** Assessment Status (grouped Assessment Progress) columns. */
export const ASSESSMENT_STATUS_COLUMNS = {
  employee: "Empleado",
  period: "Período",
  self: "Autoevaluación",
  manager: "Evaluación del manager",
  notes: "Notas de seguimiento",
} as const;

/**
 * The columns of People's org attributes file (docs/org-attributes.md), by
 * the canonical field each feeds. The profile maps them by exact header and
 * a saved profile can map any other headers onto the same fields.
 */
export const ORG_ATTRIBUTE_COLUMNS = {
  employee_bamboo_id: ["EEID"],
  employee_name: ["Nombre", "Name"],
  account: ["Cuenta", "Account"],
  project: ["Proyecto", "Project"],
  dm: ["DM"],
  santex_lead: ["Santex Lead"],
  valid_from: ["Desde", "From"],
  valid_to: ["Hasta", "To"],
} as const;

const ORG_ATTRIBUTE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ORG_ATTRIBUTE_COLUMNS).flatMap(([field, headers]) =>
    headers.map((header) => [header, field]),
  ),
);

export const builtinProfiles: SourceProfile[] = [
  // Bamboo's raw assessments report (custom report, PRD iteration 3): one row
  // per person and review period, people by EEID (Bamboo employee id) and
  // work email, closed answers as English labels. The question text of the
  // custom pairs is in the cells; the other question columns are configured
  // in `questions` (editable per account).
  {
    name: "bamboo-assessments-report",
    table: "assessments-report",
    // The key is EEID (else work email, else name) + period start, built in
    // FileSourceAdapter: a row without an EEID is still imported.
    keyColumns: ["Review Period Start"],
    entity: "assessment",
    format: "assessments_report",
    dateFormat: "mdy",
    columnMap: {
      EEID: "employee_bamboo_id",
      "Review Period Start": "period_start",
      "Correo electrónico del trabajo": "work_email",
      "Work Email": "work_email",
      "Employee Name": "employee_name",
      "Self Assessment Completed Date": "self_completed_on",
      "Manager Assessment Completed Date": "manager_completed_on",
      "Manager At Time Of Assessment": "manager_name",
    },
    optionalColumns: [
      "Correo electrónico del trabajo",
      "Work Email",
      "Employee Name",
    ],
    questions: ASSESSMENTS_REPORT_QUESTIONS,
    customQuestions: ASSESSMENTS_REPORT_CUSTOM,
  },
  // Bamboo's Assessment Progress as exported (grouped by person): parsed in
  // FileSourceAdapter into one record per person and period.
  {
    name: "bamboo-assessment-status",
    table: "assessment-status",
    keyColumns: [ASSESSMENT_STATUS_COLUMNS.employee],
    entity: "assessment_progress",
    format: "assessment_status",
    dateFormat: "mdy",
    columnMap: {
      [ASSESSMENT_STATUS_COLUMNS.employee]: "employee_group",
      [ASSESSMENT_STATUS_COLUMNS.period]: "period",
      [ASSESSMENT_STATUS_COLUMNS.self]: "self_status",
      [ASSESSMENT_STATUS_COLUMNS.manager]: "manager_status",
      [ASSESSMENT_STATUS_COLUMNS.notes]: "follow_up_notes",
    },
    optionalColumns: [ASSESSMENT_STATUS_COLUMNS.notes],
  },
  // People's file of organizational attributes (issue #85): who is on which
  // account / project, and whose delivery manager and Santex lead they have,
  // from which date. Only EEID is required; the other headers are optional
  // (and have an English alias), so a file may carry just some of the cuts.
  {
    name: "org-attributes",
    table: "org-attributes",
    // The key is EEID + Desde, built in FileSourceAdapter.
    keyColumns: ["EEID"],
    entity: "org_attribute",
    format: "org_attributes",
    // Spanish headers, Argentine dates (ISO dates and days above 12 never need it).
    dateFormat: "dmy",
    columnMap: ORG_ATTRIBUTE_MAP,
    optionalColumns: Object.keys(ORG_ATTRIBUTE_MAP).filter(
      (header) => header !== "EEID",
    ),
  },
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
    // Legacy: the standard report shape of iteration 2 (superseded by
    // bamboo-assessments-report), kept for old exports.
    name: "bamboo-employee-performance",
    legacy: true,
    table: "employee-performance",
    // Assessment Date keeps two employees with the same name apart in a cycle.
    keyColumns: ["Employee Name", "Review Cycle", "Assessment Date"],
    entity: "assessment",
    // The question columns are not in columnMap: their headers embed the
    // question text ("Employee Q1: How well does <company> recognize my
    // value?") and the company's custom questions, so they vary per account.
    // They stay in `extra`, keyed by header. `questions` configures the ones
    // of the synthetic fixtures (People edit it per account in the upload
    // screen); any other "Employee|Manager [Custom] Qn: ..." header is still
    // detected by its pattern.
    questions: BAMBOO_PERFORMANCE_QUESTIONS,
    // A row without a cycle name goes to the semester of its date.
    cycleColumn: "Review Cycle",
    dateColumn: "Assessment Date",
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
    // Legacy: flat Assessment Progress (superseded by bamboo-assessment-status).
    name: "bamboo-assessment-progress",
    legacy: true,
    table: "assessment-progress",
    // Department keeps namesakes apart (Manager can be empty, so it cannot be
    // part of a key).
    keyColumns: ["Employee Name", "Review Cycle", "Department"],
    entity: "assessment_progress",
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
