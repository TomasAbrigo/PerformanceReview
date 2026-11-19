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
import { signalsByParticipant } from "@/modules/qualitative-analysis/reading";
import { groupKeyer } from "@/modules/org-attributes/group-key";
import { ReviewError } from "@/modules/review-core/review-errors";
import {
  buildDm360,
  byCycleOrder,
  type Dm360Cycle,
  type Dm360Participant,
  treeKey,
} from "./derive";
import { type Dm360, type Dm360Scope, SPARK_CYCLES } from "./types";

type Row = {
  participant_id: string;
  person_id: string;
  cycle_id: string;
  dm: string | null;
  dm_ref_person_id: string | null;
};

type CycleRow = {
  id: string;
  name: string;
  period_start: string;
  period_end: string;
  created_at: number;
};

/**
 * The participants below each DM in the organization chart, each as of their
 * own snapshot date (`cycle_participant.snapshot_as_of`, the same date their
 * DM attribute is read on): `treeKey(cycle, dm)` -> participant ids, for the
 * DMs the file names that resolve to a person. Walks up from each participant
 * through the job history, so it reads their chain, not the DM's whole subtree.
 */
async function participantsBelow(
  db: DbOrTx,
  runAs: ActorContext,
  cycleIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const rows = await db.execute<{
    cycle_id: string;
    dm: string;
    participant_id: string;
  }>(sql`
    with recursive ${scopedCtes(runAs, { hierarchy: "asOf", cycleIds }, { snapshotScope: true })},
    roots as (
      select distinct cycle_id, dm, dm_ref_person_id as root
      from scoped
      where dm is not null and dm_ref_person_id is not null
    ),
    mine as (
      select s.participant_id, s.cycle_id, s.person_id, cp.snapshot_as_of as snap
      from scoped s join cycle_participant cp on cp.id = s.participant_id
    ),
    up as (
      select m.participant_id, m.cycle_id, m.snap, h.manager_person_id as ancestor,
             array[m.person_id, h.manager_person_id] as ids, 1 as depth
      from mine m
      join employee_job_history h on h.person_id = m.person_id
        and h.deleted_at is null and h.valid_from <= m.snap
        and (h.valid_to is null or h.valid_to > m.snap)
      where h.manager_person_id is not null
      union all
      select u.participant_id, u.cycle_id, u.snap, h.manager_person_id,
             u.ids || h.manager_person_id, u.depth + 1
      from up u
      join employee_job_history h on h.person_id = u.ancestor
        and h.deleted_at is null and h.valid_from <= u.snap
        and (h.valid_to is null or h.valid_to > u.snap)
      where h.manager_person_id is not null
        and not h.manager_person_id = any(u.ids) and u.depth < 50
    )
    select distinct u.cycle_id, r.dm, u.participant_id
    from up u join roots r on r.cycle_id = u.cycle_id and r.root = u.ancestor`);
  const below = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = treeKey(r.cycle_id, r.dm);
    const set = below.get(key) ?? new Set<string>();
    set.add(r.participant_id);
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

  // The cycle asked for and the ones before it that the evolution draws: every
  // read below is bounded to them, whatever the history holds.
  const launched = await db.execute<CycleRow>(sql`
    select id, name, period_start::text as period_start,
           period_end::text as period_end,
           extract(epoch from created_at)::float8 as created_at
    from review_cycle
    where deleted_at is null and status <> 'draft'`);
  const ordered = launched
    .map((c): Dm360Cycle => ({
      id: c.id,
      name: c.name,
      periodStart: c.period_start,
      periodEnd: c.period_end,
      createdAt: c.created_at,
    }))
    .sort(byCycleOrder);
  const at = ordered.findIndex((c) => c.id === input.cycleId);
  if (at < 0) throw new ReviewError("not_found");
  const cycles = ordered.slice(Math.max(0, at + 1 - SPARK_CYCLES), at + 1);
  const cycleIds = cycles.map((c) => c.id);
  const cycleName = ordered[at].name;

  const rows = await db.execute<Row>(sql`
    with recursive ${scopedCtes(runAs, { hierarchy: "asOf", cycleIds }, { snapshotScope: true })}
    select participant_id, person_id, cycle_id, dm, dm_ref_person_id
    from scoped`);
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

  const [indicatorRows, sides, signals, below, keyOf] = await Promise.all([
    loadRows(db, ctx, { hierarchy: "asOf", cycleIds }),
    loadSides(db, runAs, { hierarchy: "asOf", cycleIds }, { email: false }),
    signalsByParticipant(db, actor, { cycleIds }),
    scope === "tree" ? participantsBelow(db, runAs, cycleIds) : undefined,
    masked ? groupKeyer(db) : undefined,
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
    cycles,
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
      signals: new Map(signals.map((s) => [s.participantId, s.hasSignal])),
    },
    thresholds: {
      dropThreshold: ctx.config.dropThreshold,
      riskThreshold: ctx.config.riskThreshold,
    },
    minGroupSize: masked ? ctx.config.minGroupSize : null,
    keyOf,
  });
  return { ...built, cycleName };
}
