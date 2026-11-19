import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { DomainError } from "@/lib/domain-error";
import { isUuid } from "@/lib/uuid";
import { groupKeyer } from "@/modules/org-attributes/group-key";
import { getSetting } from "@/modules/settings/service";
import {
  collectCompletion,
  collectEngagementMonthly,
  collectExecutive,
  collectGoals,
  collectIndicators,
  collectPeople,
  collectQualitative,
  cycleDms,
  cycleTeams,
  type CollectContext,
} from "./collectors";
import { labelsFor, type ReportLocale } from "./labels";
import {
  arturiaReportV1,
  SCHEMA_MINOR,
  SCHEMA_VERSION,
  type ArturiaReport,
} from "./schema";

export class ArturiaError extends DomainError<"cycle_not_found"> {}

export type ReportCycle = ArturiaReport["cycle"];

/**
 * A launched (non-draft, not deleted) cycle by id, exact name, or `latest`
 * (the one with the latest period end).
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
    where status <> 'draft' and deleted_at is null and ${where}
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
  /** A cycle reference (id, name, `latest`) or the already resolved cycle. */
  cycle: string | ReportCycle;
  locale?: ReportLocale;
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
  const cycle =
    typeof opts.cycle === "string"
      ? await resolveCycle(db, opts.cycle)
      : opts.cycle;
  const locale = opts.locale ?? "es";
  const minGroupSize =
    opts.minGroupSize ?? (await getSetting(db, "aggregation.minGroupSize"));
  const labels = labelsFor(locale);
  const ctx: CollectContext = {
    cycleId: cycle.id,
    period: { start: cycle.periodStart, end: cycle.periodEnd },
    anonymized: opts.anonymized,
    min: opts.anonymized ? minGroupSize : 1,
    locale,
    labels,
    teams: await cycleTeams(db, cycle.id, labels.team),
    dms: await cycleDms(db, cycle.id, labels.dm, await groupKeyer(db)),
  };
  const [
    executive,
    completion,
    indicators,
    qualitative,
    goals,
    engagementMonthly,
    people,
  ] = await Promise.all([
    collectExecutive(db, ctx),
    collectCompletion(db, ctx),
    collectIndicators(db, ctx),
    collectQualitative(db, ctx),
    collectGoals(db, ctx),
    collectEngagementMonthly(db, ctx),
    collectPeople(db, ctx),
  ]);
  return arturiaReportV1.parse({
    schemaVersion: SCHEMA_VERSION,
    schemaMinor: SCHEMA_MINOR,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    locale,
    cycle,
    anonymized: opts.anonymized,
    minGroupSize,
    sections: {
      executive,
      completion,
      indicators,
      qualitative,
      goals,
      engagementMonthly,
      people,
    },
  });
}
