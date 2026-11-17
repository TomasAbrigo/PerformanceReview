/**
 * Test-only builders of indicator data (db tests): cycles with the retention
 * and engagement question revisions, and the manager reviews that answer them
 * (Likert 1-5). They write the rows the historical import leaves, directly.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  answer,
  type QuestionRole,
  questionRevision,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import {
  insertJob,
  insertParticipant,
  insertPerson,
} from "@/modules/analytics/test-support";
import type { Indicator, IndicatorActor } from "./types";

export const hr: IndicatorActor = { personId: null, role: "hr" };
export const direction: IndicatorActor = { personId: null, role: "direction" };
export const as = (
  personId: string,
  role: IndicatorActor["role"],
): IndicatorActor => ({ personId, role });

const LIKERT = [1, 2, 3, 4, 5].map((value) => ({
  value,
  label: { es: `N${value}`, en: `L${value}` },
  normalized: (value - 1) / 4,
}));

export type TestCycle = {
  cycleId: string;
  questions: Record<Indicator, string>;
};

/** A closed cycle with its two indicator questions (manager, hidden from the reviewee). */
export async function insertIndicatorCycle(c: {
  name: string;
  periodStart: string;
  periodEnd: string;
  status?: "draft" | "closed";
}): Promise<TestCycle> {
  const [cycle] = await db
    .insert(reviewCycle)
    .values({
      name: c.name,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      snapshotDate: c.periodEnd,
      status: c.status ?? "closed",
      components: {
        self: true,
        manager: true,
        peer: false,
        upward: false,
        calibration: false,
      },
      anonymity: { peer: "transparent", upward: "transparent" },
    })
    .returning({ id: reviewCycle.id });
  const question = async (indicator: Indicator, sort: number) => {
    const [row] = await db
      .insert(questionRevision)
      .values({
        cycleId: cycle.id,
        sectionTitle: { es: "Evaluación del manager", en: "Manager review" },
        prompt: { es: indicator, en: indicator },
        kind: "rating",
        appliesTo: ["manager"],
        visibleToReviewee: false,
        required: true,
        scale: { options: LIKERT },
        sort,
        // The roles arrive with the import of the Santex template (#57).
        role: indicator as string as QuestionRole,
      })
      .returning({ id: questionRevision.id });
    return row.id;
  };
  return {
    cycleId: cycle.id,
    questions: {
      retention: await question("retention", 0),
      engagement: await question("engagement", 1),
    },
  };
}

/**
 * A review request of `participantId` with its indicator answers (a missing
 * value leaves the question unanswered). By default the manager's, submitted.
 */
export async function insertIndicatorReview(r: {
  cycle: TestCycle;
  participantId: string;
  reviewerPersonId: string;
  retention?: number | null;
  engagement?: number | null;
  relationship?: "manager" | "self";
  status?: "submitted" | "draft";
  submittedAt?: Date;
  deleted?: boolean;
}): Promise<string> {
  const status = r.status ?? "submitted";
  const [request] = await db
    .insert(reviewRequest)
    .values({
      cycleId: r.cycle.cycleId,
      participantId: r.participantId,
      reviewerPersonId: r.reviewerPersonId,
      relationship: r.relationship ?? "manager",
      status,
      submittedAt:
        status === "submitted" ? (r.submittedAt ?? new Date()) : null,
      deletedAt: r.deleted ? new Date() : null,
    })
    .returning({ id: reviewRequest.id });
  const rows = (["retention", "engagement"] as const).flatMap((indicator) => {
    const value = r[indicator];
    return value == null
      ? []
      : [
          {
            requestId: request.id,
            questionRevisionId: r.cycle.questions[indicator],
            optionValue: value,
            optionLabel: `N${value}`,
            normalized: (value - 1) / 4,
          },
        ];
  });
  if (rows.length) await db.insert(answer).values(rows);
  return request.id;
}

/**
 * Two semester cycles of an organisation with two teams. Retention (R) and
 * engagement (E) as the manager answered them, per person and cycle (C1 =
 * H1 2024, C2 = H2 2024); "-" = not answered / not in the cycle:
 *
 *   Ingeniería, manager Marta          C1 (R,E)   C2 (R,E)
 *     Ana Prieto                        4,4        2,4
 *     Bruno Soler                       3,3        2,2
 *     Carla Vega                        5,4        5,5
 *     Dario Mena                        -          3,3
 *     Elena Ríos                        4,5        4,2
 *     Fabio Luna                        3,4        1,1
 *   Producto, manager Nora
 *     Gina Paz                          2,2        2,2
 *     Hugo Sosa                         -          4,4
 *     Iris Cano                         -          5,-
 *
 * Today (job history) Ana Prieto works in Producto under Nora; everybody
 * else is where the snapshots say.
 */
export const names = {
  marta: "Marta Quiroga",
  nora: "Nora Salas",
  ana: "Ana Prieto",
  bruno: "Bruno Soler",
  carla: "Carla Vega",
  dario: "Dario Mena",
  elena: "Elena Ríos",
  fabio: "Fabio Luna",
  gina: "Gina Paz",
  hugo: "Hugo Sosa",
  iris: "Iris Cano",
} as const;
export type Who = keyof typeof names;

type Pair = [number | null, number | null];
const C1: Partial<Record<Who, Pair>> = {
  ana: [4, 4],
  bruno: [3, 3],
  carla: [5, 4],
  elena: [4, 5],
  fabio: [3, 4],
  gina: [2, 2],
};
const C2: Partial<Record<Who, Pair>> = {
  ana: [2, 4],
  bruno: [2, 2],
  carla: [5, 5],
  dario: [3, 3],
  elena: [4, 2],
  fabio: [1, 1],
  gina: [2, 2],
  hugo: [4, 4],
  iris: [5, null],
};
const teamOf = (who: Who): Who =>
  (["gina", "hugo", "iris"] as Who[]).includes(who) ? "nora" : "marta";
const departmentOf = (who: Who) =>
  teamOf(who) === "marta" ? "Ingeniería" : "Producto";

export async function reset() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

export type Scenario = {
  id: Record<Who, string>;
  c1: TestCycle;
  c2: TestCycle;
  /** The participant row of `who` in `cycle`. */
  participant: (cycle: TestCycle, who: Who) => string;
};

/** Empties the tables and writes the organisation above. */
export async function buildScenario(): Promise<Scenario> {
  await reset();
  const entries = await Promise.all(
    (Object.keys(names) as Who[]).map(async (who) => [
      who,
      await insertPerson({ displayName: names[who], noEmployment: true }),
    ]),
  );
  const id = Object.fromEntries(entries) as Record<Who, string>;
  for (const who of Object.keys(names) as Who[]) {
    if (who === "marta" || who === "nora") continue;
    if (who === "ana") {
      await insertJob({
        personId: id.ana,
        validFrom: "2023-01-01",
        validTo: "2025-01-01",
        managerPersonId: id.marta,
        department: "Ingeniería",
      });
      await insertJob({
        personId: id.ana,
        validFrom: "2025-01-01",
        managerPersonId: id.nora,
        department: "Producto",
      });
    } else {
      await insertJob({
        personId: id[who],
        validFrom: "2023-01-01",
        managerPersonId: id[teamOf(who)],
        department: departmentOf(who),
      });
    }
  }
  const c1 = await insertIndicatorCycle({
    name: "H1 2024",
    periodStart: "2024-01-01",
    periodEnd: "2024-06-30",
  });
  const c2 = await insertIndicatorCycle({
    name: "H2 2024",
    periodStart: "2024-07-01",
    periodEnd: "2024-12-31",
  });
  const participants = new Map<string, string>();
  const participant = (cycle: TestCycle, who: Who) =>
    participants.get(`${cycle.cycleId}:${who}`)!;
  for (const [cycle, data] of [
    [c1, C1],
    [c2, C2],
  ] as const) {
    for (const [who, [retention, engagement]] of Object.entries(data) as [
      Who,
      Pair,
    ][]) {
      const participantId = await insertParticipant({
        cycleId: cycle.cycleId,
        personId: id[who],
        snapManagerPersonId: id[teamOf(who)],
        snapDepartment: departmentOf(who),
      });
      participants.set(`${cycle.cycleId}:${who}`, participantId);
      await insertIndicatorReview({
        cycle,
        participantId,
        reviewerPersonId: id[teamOf(who)],
        retention,
        engagement,
      });
    }
  }
  return { id, c1, c2, participant };
}
