import type { SourceSystem } from "@/db/schema";
import type {
  ExtractContext,
  ExtractedRecord,
  IngestEntity,
  RejectedRecord,
  SourceAdapter,
} from "@/modules/ingest/types";
import { applyProfile, readOptionsFor, type SourceProfile } from "./profiles";
import type { LakeAdapter, LakeRow } from "./types";

/**
 * Where a profile's rows come from: the Bamboo report exports (profiles named
 * `bamboo-*`) are `bamboo_export`; Fivetran, Airbyte and custom tables are
 * `lake`. Part of raw_record's identity, so the same file always lands in the
 * same place.
 */
export function sourceSystemFor(profile: SourceProfile): SourceSystem {
  return profile.name.startsWith("bamboo-") ? "bamboo_export" : "lake";
}

export type FileSourceAdapterOptions = {
  /** Rows per lake batch (default: the lake's). */
  batchSize?: number;
};

/**
 * `SourceAdapter` over one table of a `LakeAdapter` (an uploaded file, or any
 * lake), seen through a source profile. One record per row; the sourceId is
 * the profile's key. A row the profile cannot map (an empty key column, like
 * Bamboo's "No Goals Set" rows) is reported as a `RejectedRecord` with the
 * reason, never thrown, so one bad row does not stop the run.
 *
 * The payload keeps the row three ways so nothing is lost: `fields` (mapped
 * columns under their canonical names), `extra` (every other column) and
 * `raw` (the row as read, under the original headers).
 */
export class FileSourceAdapter implements SourceAdapter {
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
    this.source = sourceSystemFor(profile);
    this.entities = [profile.entity];
  }

  extract(
    ctx: ExtractContext,
    entity: IngestEntity,
  ): AsyncIterable<ExtractedRecord | RejectedRecord> {
    if (entity !== this.profile.entity) {
      throw new Error(
        `Profile "${this.profile.name}" feeds "${this.profile.entity}" records, not "${entity}"`,
      );
    }
    return this.read(ctx);
  }

  private async *read(
    ctx: ExtractContext,
  ): AsyncGenerator<ExtractedRecord | RejectedRecord> {
    const { profile } = this;
    const extractedAt = new Date();
    const options = readOptionsFor(profile, {
      since: ctx.since,
      batchSize: this.options.batchSize,
    });
    for await (const { rows } of this.lake.readBatches(this.table, options)) {
      for (const row of rows) {
        let record: ReturnType<typeof applyProfile>;
        try {
          record = applyProfile(profile, row);
        } catch (error) {
          yield {
            rejected: true,
            sourceId: null,
            reason: `${(error as Error).message} (${describeKey(profile, row)})`,
          };
          continue;
        }
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

/** `Employee Name="Ana", Goal=∅`: tells which row a reject was about. */
function describeKey(profile: SourceProfile, row: LakeRow): string {
  return profile.keyColumns
    .map((column) => {
      const value = row[column];
      return `${column}=${value === null || value === undefined ? "∅" : JSON.stringify(String(value))}`;
    })
    .join(", ");
}
