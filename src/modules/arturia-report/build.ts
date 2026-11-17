import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { DomainError } from "@/lib/domain-error";
import { isUuid } from "@/lib/uuid";
import { getSetting } from "@/modules/settings/service";
import {
  collectCompletion,
  collectExecutive,
  collectGoals,
  collectIndicators,
  collectPeople,
  collectQualitative,
  type CollectContext,
} from "./collectors";
import {
  arturiaReportV1,
  SCHEMA_MINOR,
  SCHEMA_VERSION,
  type ArturiaReport,
} from "./schema";

export class ArturiaError extends DomainError<"cycle_not_found"> {}

export type ReportCycle = ArturiaReport["cycle"];

/**
 * A launched (non-draft) cycle by id, exact name, or `latest` (the one with
 * the latest period end).
 */
export async function resolveCycle(
  db: DbOrTx,
  ref: string,
): Promise<ReportCycle> {
  const where =
    ref === "latest"
      ? sql`true`
      : isUuid(ref)
        ? sql`id = ${ref}::uuid`
        : sql`name = ${ref}`;
  const [c] = await db.execute<{
    id: string;
    name: string;
    period_start: string;
    period_end: string;
  }>(sql`
    select id, name, period_start::text, period_end::text from review_cycle
    where status <> 'draft' and ${where}
    order by period_end desc, created_at desc limit 1`);
  if (!c) throw new ArturiaError("cycle_not_found");
  return {
    id: c.id,
    name: c.name,
    periodStart: c.period_start,
    periodEnd: c.period_end,
  };
}

export type BuildOptions = {
  cycleId: string;
  anonymized: boolean;
  /** Default: the `aggregation.minGroupSize` setting. */
  minGroupSize?: number;
  now?: Date;
};

/** Builds (and validates) the report of a cycle. */
export async function buildReport(
  db: DbOrTx,
  opts: BuildOptions,
): Promise<ArturiaReport> {
  const cycle = await resolveCycle(db, opts.cycleId);
  const minGroupSize =
    opts.minGroupSize ?? (await getSetting(db, "aggregation.minGroupSize"));
  const ctx: CollectContext = {
    cycleId: cycle.id,
    anonymized: opts.anonymized,
    min: opts.anonymized ? minGroupSize : 1,
  };
  const [executive, completion, indicators, qualitative, goals, people] =
    await Promise.all([
      collectExecutive(db, ctx),
      collectCompletion(db, ctx),
      collectIndicators(db, ctx),
      collectQualitative(db, ctx),
      collectGoals(db, ctx),
      collectPeople(db, ctx),
    ]);
  return arturiaReportV1.parse({
    schemaVersion: SCHEMA_VERSION,
    schemaMinor: SCHEMA_MINOR,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    cycle,
    anonymized: opts.anonymized,
    minGroupSize,
    sections: { executive, completion, indicators, qualitative, goals, people },
  });
}
