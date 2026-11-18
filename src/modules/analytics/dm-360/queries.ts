import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { loadSides } from "@/modules/analytics/completion/queries";
import { ALL_PEOPLE, scopedCtes } from "@/modules/analytics/dashboards/scope";
import {
  indicatorContext,
  loadRows,
  requireUuid,
} from "@/modules/analytics/indicators/rows";
import type { IndicatorConfig } from "@/modules/analytics/indicators/types";
import { sentimentByParticipant } from "@/modules/qualitative-analysis/queries";
import { ReviewError } from "@/modules/review-core/review-errors";
import {
  buildDm360,
  type Dm360Cycle,
  type Dm360Participant,
  treeKey,
} from "./derive";
import type { Dm360, Dm360Scope } from "./types";

type Row = {
  participant_id: string;
  person_id: string;
  cycle_id: string;
  cycle_name: string;
  period_start: string;
  period_end: string;
  cycle_created_at: number;
  dm: string | null;
  dm_ref_person_id: string | null;
};

/**
 * The people below each DM in the organization chart of each cycle's snapshot
 * date: `treeKey(cycle, dm)` -> person ids, for the DMs the file names that
 * resolve to a person. One recursion over the job history for all of them.
 */
async function peopleBelow(
  db: DbOrTx,
  runAs: ActorContext,
): Promise<Map<string, Set<string>>> {
  const rows = await db.execute<{
    cycle_id: string;
    dm: string;
    person_id: string;
  }>(sql`
    with recursive ${scopedCtes(runAs, { hierarchy: "asOf" }, { snapshotScope: true })},
    roots as (
      select distinct s.cycle_id, s.dm, s.dm_ref_person_id as root,
             c.snapshot_date as snap
      from scoped s join review_cycle c on c.id = s.cycle_id
      where s.dm is not null and s.dm_ref_person_id is not null
    ),
    sub as (
      select r.cycle_id, r.dm, r.snap, h.person_id,
             array[h.person_id] as ids, 1 as depth
      from roots r
      join employee_job_history h on h.manager_person_id = r.root
        and h.deleted_at is null and h.valid_from <= r.snap
        and (h.valid_to is null or h.valid_to > r.snap)
      union all
      select s.cycle_id, s.dm, s.snap, h.person_id,
             s.ids || h.person_id, s.depth + 1
      from sub s
      join employee_job_history h on h.manager_person_id = s.person_id
        and h.deleted_at is null and h.valid_from <= s.snap
        and (h.valid_to is null or h.valid_to > s.snap)
      where not h.person_id = any(s.ids) and s.depth < 50
    )
    select distinct cycle_id, dm, person_id from sub`);
  const below = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = treeKey(r.cycle_id, r.dm);
    const set = below.get(key) ?? new Set<string>();
    set.add(r.person_id);
    below.set(key, set);
  }
  return below;
}

/**
 * The "Análisis 360" of a cycle: one card per DM (the delivery manager of the
 * org attributes file, as of each participant's cycle snapshot) with the
 * people under them, the mean retention and engagement the managers gave,
 * the share at risk, the sentiment of the comments, the completion of the
 * assessments, the evolution over the latest cycles and a sentence per rule
 * that applies (see `insightsOf`).
 *
 * `scope`: `direct` (default) the people the DM attribute names; `tree` also
 * everybody below the DM in the chart of the snapshot (the DM must resolve to
 * a person; a manager always reads `direct`).
 *
 * People read every card. A manager reads only their own, when they are a DM
 * (the file's DM resolves to them), counting their direct reports of the
 * snapshot, as everywhere. Direction reads aggregates: cards of DMs with at
 * least `aggregation.minGroupSize` people, without the DM's name, the rest
 * folded into "Otros" (or left out and counted in `suppressed`), and no
 * figure over fewer people than that. Employees are forbidden.
 */
export async function dm360(
  db: DbOrTx,
  actor: ActorContext,
  input: {
    cycleId: string;
    scope?: Dm360Scope;
    /** Replaces some thresholds for this call (tests); the settings otherwise. */
    config?: Partial<IndicatorConfig>;
  },
): Promise<Dm360> {
  const ctx = await indicatorContext(db, actor, input.config);
  requireUuid(input.cycleId);
  const masked = ctx.scope.kind === "aggregatesOnly";
  const runAs = masked ? ALL_PEOPLE : actor;
  const scope: Dm360Scope =
    ctx.scope.kind === "directReports" ? "direct" : (input.scope ?? "direct");

  const rows = await db.execute<Row>(sql`
    with recursive ${scopedCtes(runAs, { hierarchy: "asOf" }, { snapshotScope: true })}
    select participant_id, person_id, cycle_id, cycle_name, period_start,
           period_end, cycle_created_at, dm, dm_ref_person_id
    from scoped`);
  const cycleRow = rows.find((r) => r.cycle_id === input.cycleId);
  const cycleName =
    cycleRow?.cycle_name ??
    (
      await db.execute<{ name: string }>(sql`
        select name from review_cycle
        where id = ${input.cycleId}::uuid and deleted_at is null and status <> 'draft'`)
    )[0]?.name;
  if (!cycleName) throw new ReviewError("not_found");

  const cycles = new Map<string, Dm360Cycle>();
  for (const r of rows) {
    cycles.set(r.cycle_id, {
      id: r.cycle_id,
      name: r.cycle_name,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      createdAt: r.cycle_created_at,
    });
  }
  const participants: Dm360Participant[] = rows.map((r) => ({
    participantId: r.participant_id,
    personId: r.person_id,
    cycleId: r.cycle_id,
    dm: r.dm,
  }));
  // A manager reads their own card: the DMs of the file that resolve to them.
  const reach = ctx.scope;
  const dms =
    reach.kind === "directReports"
      ? new Set(
          rows.flatMap((r) =>
            r.dm && r.dm_ref_person_id === reach.managerPersonId ? [r.dm] : [],
          ),
        )
      : null;

  const [indicatorRows, sides, sentiments, below] = await Promise.all([
    loadRows(db, ctx, { hierarchy: "asOf" }),
    loadSides(db, runAs, { hierarchy: "asOf" }, { email: false }),
    sentimentByParticipant(db, actor, {}),
    scope === "tree" ? peopleBelow(db, runAs) : undefined,
  ]);
  const retention = new Map<string, number>();
  const engagement = new Map<string, number>();
  for (const r of indicatorRows) {
    (r.indicator === "retention" ? retention : engagement).set(
      r.participantId,
      r.value,
    );
  }

  const built = buildDm360({
    cycles: [...cycles.values()],
    cycleId: input.cycleId,
    participants,
    scope,
    below,
    dms,
    facts: {
      retention,
      engagement,
      sides: new Map(
        sides.map((s) => [
          s.participantId,
          { self: s.selfStatus, manager: s.managerStatus },
        ]),
      ),
      sentiment: new Map(sentiments.map((s) => [s.participantId, s])),
    },
    thresholds: {
      dropThreshold: ctx.config.dropThreshold,
      riskThreshold: ctx.config.riskThreshold,
    },
    minGroupSize: masked ? ctx.config.minGroupSize : null,
  });
  return { ...built, cycleName };
}
