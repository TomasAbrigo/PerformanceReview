import type { SourceSystem } from "@/db/schema";
import type {
  ExtractContext,
  ExtractedRecord,
  IngestEntity,
  SourceAdapter,
} from "@/modules/ingest/types";
import { applyProfile, readOptionsFor, type SourceProfile } from "./profiles";
import type { LakeAdapter, LakeRow } from "./types";

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
    for await (const { rows } of this.lake.readBatches(this.table, options)) {
      for (const row of rows) {
        // A stopped run (the worker was told to terminate) ends at the next row.
        ctx.signal?.throwIfAborted();
        const empty = profile.keyColumns.find((c) => isEmpty(row[c]));
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
        const record = applyProfile(profile, row);
        yield {
          sourceId: record.sourceId,
          payload: {
            fields: record.fields,
            extra: record.extra,
            deleted: record.deleted,
            watermark: record.watermark,
            raw: row,
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
