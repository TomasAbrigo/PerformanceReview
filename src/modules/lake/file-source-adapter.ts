import type { SourceSystem } from "@/db/schema";
import type {
  ExtractContext,
  ExtractedRecord,
  IngestEntity,
  SourceAdapter,
} from "@/modules/ingest/types";
import { parseEngagementMonth } from "@/modules/engagement/kinds";
import { payloadHash } from "@/modules/ingest/canonical";
import {
  parseReportDate,
  parseReportPeriod,
} from "@/modules/import-history/dates";
import { applyProfile, readOptionsFor, type SourceProfile } from "./profiles";
import type { JsonValue, LakeAdapter, LakeRow, ReadOptions } from "./types";

/**
 * The source system of a BUILT-IN profile: the Bamboo report exports
 * (`bamboo-*`) are `bamboo_export`; Fivetran and Airbyte tables are `lake`.
 * Only for built-in profiles, so the caller has to know the profile is one:
 * a custom profile is a `lake` source whatever it is called. Part of
 * raw_record's identity, so the same file always lands in the same place.
 */
export function builtinSourceSystem(profile: SourceProfile): SourceSystem {
  return profile.name.startsWith("bamboo-") ? "bamboo_export" : "lake";
}

export type FileSourceAdapterOptions = {
  /** Rows per lake batch (default: the lake's). */
  batchSize?: number;
  /** Where the rows come from (default `lake`; see {@link builtinSourceSystem}). */
  source?: SourceSystem;
  /**
   * Identity of the file (its sha256), for `syntheticKey` profiles: a row
   * without a key is `row:<sha256(file + ordinal)>`, so identical rows are
   * kept apart and the same file lands unchanged. An edited file is a new
   * version: its rows land again, the old ones are not reconciled.
   */
  fileKey?: string;
};

/**
 * `SourceAdapter` over one table of a `LakeAdapter` (an uploaded file, or any
 * lake), seen through a source profile. One record per row; the sourceId is
 * the profile's key. A row the profile cannot map (an empty key column, like
 * Bamboo's "No Goals Set" rows) is handed to `ctx.onReject` with the reason
 * instead of being thrown, so one bad row does not stop the run. (Without an
 * `onReject` there is nowhere to report it, so the error is thrown rather
 * than the row silently dropped.)
 *
 * The payload keeps the row three ways so nothing is lost: `fields` (mapped
 * columns under their canonical names), `extra` (every other column) and
 * `raw` (the row as read, under the original headers).
 */
export class FileSourceAdapter implements SourceAdapter<IngestEntity> {
  readonly source: SourceSystem;
  readonly name = "file";
  readonly entities: readonly IngestEntity[];

  constructor(
    private readonly profile: SourceProfile,
    private readonly lake: LakeAdapter,
    /** Lake table to read; defaults to the profile's own. */
    private readonly table: string = profile.table,
    private readonly options: FileSourceAdapterOptions = {},
  ) {
    this.source = options.source ?? "lake";
    this.entities = [profile.entity];
  }

  extract(
    ctx: ExtractContext,
    entity: IngestEntity,
  ): AsyncIterable<ExtractedRecord> {
    if (entity !== this.profile.entity) {
      throw new Error(
        `Profile "${this.profile.name}" feeds "${this.profile.entity}" records, not "${entity}"`,
      );
    }
    return this.read(ctx);
  }

  private async *read(ctx: ExtractContext): AsyncGenerator<ExtractedRecord> {
    const { profile } = this;
    const extractedAt = new Date();
    const options = readOptionsFor(profile, {
      since: ctx.since,
      batchSize: this.options.batchSize,
    });
    if (profile.syntheticKey) {
      // Any columns: page by the key columns the file has, or by all of them.
      const columns = (await this.lake.describeTable(this.table)).map(
        (c) => c.name,
      );
      const present = options.keyColumns.filter((c) => columns.includes(c));
      options.keyColumns = present.length > 0 ? present : columns;
    }
    if (profile.format === "assessment_status") {
      yield* groupedStatusRecords(profile, this.lake, this.table, options, ctx);
      return;
    }
    let ordinal = 0;
    const fileKey = this.options.fileKey ?? this.table;
    for await (const { rows } of this.lake.readBatches(this.table, options)) {
      for (const row of rows) {
        // A stopped run (the worker was told to terminate) ends at the next row.
        ctx.signal?.throwIfAborted();
        const empty = profile.syntheticKey
          ? undefined
          : profile.keyColumns.find(
              (c) => c !== profile.cycleColumn && isEmpty(row[c]),
            );
        if (empty !== undefined) {
          const reason =
            `Profile "${profile.name}": key column "${empty}" is empty in the row ` +
            `(${describeKey(profile, row)})`;
          if (!ctx.onReject) throw new Error(reason);
          ctx.onReject({
            sourceId: null,
            reason,
            code: "empty_key",
            column: empty,
            values: Object.fromEntries(
              profile.keyColumns.map((c) => [
                c,
                isEmpty(row[c]) ? null : String(row[c]),
              ]),
            ),
          });
          continue;
        }
        const index = ordinal++;
        const record = applyProfile(
          profile,
          row,
          () => `row:${payloadHash({ file: fileKey, row: index })}`,
        );
        if (profile.format === "org_attributes") {
          record.sourceId = orgAttributeKey(profile, record.fields);
        }
        if (profile.format === "engagement_monthly") {
          record.sourceId = engagementKey(record.fields);
        }
        if (profile.format === "assessments_report") {
          const key = rawReportKey(profile, record.fields);
          if (!key) {
            const reason = `Profile "${profile.name}": the row has no EEID, work email or name (${describeKey(profile, row)})`;
            if (!ctx.onReject) throw new Error(reason);
            ctx.onReject({ sourceId: null, reason });
            continue;
          }
          record.sourceId = key;
        }
        yield {
          sourceId: record.sourceId,
          payload: {
            fields: record.fields,
            extra: record.extra,
            deleted: record.deleted,
            watermark: record.watermark,
            raw: row,
            // Only when set: payloads (and their hashes) stay as they were.
            ...(profile.format ? { format: profile.format } : {}),
            ...(profile.customQuestions
              ? { customQuestions: profile.customQuestions }
              : {}),
            ...(profile.dateFormat ? { dateFormat: profile.dateFormat } : {}),
          },
          extractedAt,
        };
      }
    }
  }
}

const isEmpty = (value: LakeRow[string] | undefined) =>
  value === null || value === undefined;

/** `Employee Name="Ana", Goal=∅`: tells which row a reject was about. */
function describeKey(profile: SourceProfile, row: LakeRow): string {
  return profile.keyColumns
    .map((column) => {
      const value = row[column];
      return `${column}=${isEmpty(value) ? "∅" : JSON.stringify(String(value))}`;
    })
    .join(", ");
}

const textOf = (value: JsonValue | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
};

/** "Ana Pérez 1042" -> name and employee number (a trailing number). */
export function splitGroupHeader(cell: string): {
  name: string;
  employeeNumber: string | null;
} {
  const match = /^(.*\S)\s+(\d+)$/.exec(cell.trim());
  return match
    ? { name: match[1], employeeNumber: match[2] }
    : { name: cell.trim(), employeeNumber: null };
}

/**
 * Bamboo's Assessment Progress as exported: a row naming the person
 * ("<name> <employee number>") and then one row per review period
 * ("MM/DD/YYYY - MM/DD/YYYY", self status, manager status, notes). Read in
 * file order; each period row becomes one record of its person, keyed by
 * employee number (else name) and the period as written.
 */
async function* groupedStatusRecords(
  profile: SourceProfile,
  lake: LakeAdapter,
  table: string,
  options: ReadOptions,
  ctx: ExtractContext,
): AsyncGenerator<ExtractedRecord> {
  const extractedAt = new Date();
  const columnOf = (field: string) =>
    Object.entries(profile.columnMap).find(([, f]) => f === field)?.[0];
  const employeeColumn = columnOf("employee_group")!;
  const periodColumn = columnOf("period")!;
  let group: { name: string; employeeNumber: string | null } | null = null;
  for await (const { rows } of lake.readBatches(table, options)) {
    for (const row of rows) {
      ctx.signal?.throwIfAborted();
      const who = textOf(row[employeeColumn]);
      if (who) group = splitGroupHeader(who);
      const period = textOf(row[periodColumn]);
      if (!period) continue;
      if (!group) {
        const reason = `Profile "${profile.name}": period row "${period}" comes before any person row`;
        if (!ctx.onReject) throw new Error(reason);
        ctx.onReject({
          sourceId: null,
          reason,
          code: "empty_key",
          column: employeeColumn,
          values: { [employeeColumn]: null },
        });
        continue;
      }
      const fields: Record<string, JsonValue> = {
        employee_name: group.name,
        employee_number: group.employeeNumber,
      };
      const extra: Record<string, JsonValue> = {};
      for (const [column, value] of Object.entries(row)) {
        const canonical = profile.columnMap[column];
        if (canonical === "employee_group") continue;
        if (canonical) fields[canonical] = value;
        else extra[column] = value;
      }
      const parsed = parseReportPeriod(period, profile.dateFormat);
      yield {
        sourceId: JSON.stringify([
          group.employeeNumber ?? group.name,
          parsed?.start ?? period,
        ]),
        payload: {
          format: profile.format,
          fields,
          extra,
          deleted: false,
          watermark: null,
          raw: row,
          ...(profile.dateFormat ? { dateFormat: profile.dateFormat } : {}),
        },
        extractedAt,
      };
    }
  }
}

/**
 * The key of a raw assessments report row: who (EEID, else the work email,
 * else the name) and the period start as an ISO date. Rows without an EEID
 * still get one, so the email/name fallback of the import can run.
 */
function rawReportKey(
  profile: SourceProfile,
  fields: Record<string, JsonValue>,
): string | null {
  const text = (v: JsonValue | undefined) => textOf(v);
  const eeid = text(fields.employee_bamboo_id);
  const email = text(fields.work_email)?.toLowerCase();
  const name = text(fields.employee_name);
  const who = eeid ?? (email ? `email:${email}` : name ? `name:${name}` : null);
  if (!who) return null;
  const start = text(fields.period_start);
  return JSON.stringify([
    who,
    parseReportDate(start, profile.dateFormat) ?? start ?? "",
  ]);
}

/**
 * The key of a row of the org attributes file: EEID and the date it starts
 * (ISO; empty when the row has none), so a person's rows of different periods
 * are different records and the same row again is the same one.
 */
function orgAttributeKey(
  profile: SourceProfile,
  fields: Record<string, JsonValue>,
): string {
  const from = textOf(fields.valid_from);
  return JSON.stringify([
    textOf(fields.employee_bamboo_id) ?? "",
    parseReportDate(from, profile.dateFormat) ?? from ?? "",
  ]);
}

/**
 * The key of a row of the monthly engagement file: EEID and the month (the
 * first of it, ISO), however the file writes it (`2026-03`, `03/2026`), so the
 * same person and month is one record across files.
 */
function engagementKey(fields: Record<string, JsonValue>): string {
  const month = textOf(fields.month);
  return JSON.stringify([
    textOf(fields.employee_bamboo_id) ?? "",
    parseEngagementMonth(month) ?? month ?? "",
  ]);
}
