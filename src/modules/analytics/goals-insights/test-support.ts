/**
 * Test-only builders of goals-vs-assessment data (db tests): a semester cycle
 * with its participants' snapshot of goals, the manager's retention and
 * engagement answers (Likert 1-5) and labeled comments. They write the rows
 * the historical import and the qualitative analysis leave, directly.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  answer,
  type GoalStatus,
  participantGoalSnapshot,
  questionRevision,
  reviewCycle,
  reviewRequest,
} from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  insertJob,
  insertParticipant,
  insertPerson,
} from "@/modules/analytics/test-support";
import type { Indicator } from "./types";

export const hr: ActorContext = { personId: null, role: "hr" };
export const direction: ActorContext = { personId: null, role: "direction" };
export const as = (
  personId: string,
  role: ActorContext["role"],
): ActorContext => ({ personId, role });

const LIKERT = [1, 2, 3, 4, 5].map((value) => ({
  value,
  label: { es: `N${value}`, en: `L${value}` },
  normalized: (value - 1) / 4,
}));

export type TestCycle = {
  cycleId: string;
  questions: Record<Indicator, string> & { text: string };
};

/** A closed cycle with the two indicator questions (manager) and a text one (both). */
async function insertCycle(c: {
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
  const rating = async (indicator: Indicator, sort: number) => {
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
        role: indicator,
      })
      .returning({ id: questionRevision.id });
    return row.id;
  };
  const [text] = await db
    .insert(questionRevision)
    .values({
      cycleId: cycle.id,
      sectionTitle: { es: "Comentarios", en: "Comments" },
      prompt: { es: "Fortalezas", en: "Strengths" },
      kind: "text",
      appliesTo: ["self", "manager"],
      visibleToReviewee: true,
      required: false,
      sort: 2,
      dimension: "strengths",
    })
    .returning({ id: questionRevision.id });
  return {
    cycleId: cycle.id,
    questions: {
      retention: await rating("retention", 0),
      engagement: await rating("engagement", 1),
      text: text.id,
    },
  };
}

export type TestGoal = {
  status: GoalStatus;
  percent: number;
  /** yyyy-mm-dd or none. */
  due?: string | null;
  noLongerApplicable?: boolean;
};

/** The goal snapshot of a participant: one row per goal. */
export async function insertGoals(
  participantId: string,
  goals: TestGoal[],
): Promise<void> {
  if (goals.length === 0) return;
  await db.insert(participantGoalSnapshot).values(
    goals.map((g, i) => ({
      participantId,
      goalSourceKey: `test:${participantId}:${i}`,
      title: `Goal ${i + 1}`,
      status: g.status,
      percentComplete: g.percent,
      dueDate: g.due ?? null,
      noLongerApplicable: g.noLongerApplicable ?? false,
    })),
  );
}

/** `n` copies of the same goal. */
export const times = (n: number, goal: TestGoal): TestGoal[] =>
  Array.from({ length: n }, () => goal);

/**
 * A request of `participantId` with its indicator answers (a missing value
 * leaves the question unanswered). By default the manager's, submitted.
 */
export async function insertReview(r: {
  cycle: TestCycle;
  participantId: string;
  reviewerPersonId: string;
  retention?: number | null;
  engagement?: number | null;
  relationship?: "manager" | "self" | "peer" | "upward";
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

export type TestSentiment = "positive" | "constructive" | "negative";

/**
 * Open-text answers of an existing request, each with the machine label
 * given (the answer's text is "<label> <n>"); returns the answer ids.
 */
export async function insertLabeledComments(
  cycle: TestCycle,
  requestId: string,
  labels: TestSentiment[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, sentiment] of labels.entries()) {
    const text = `${sentiment} ${i + 1}`;
    // One text question per request: the n-th comment goes to a fresh revision.
    const [question] = await db
      .insert(questionRevision)
      .values({
        cycleId: cycle.cycleId,
        sectionTitle: { es: "Comentarios", en: "Comments" },
        prompt: { es: `Comentario ${i + 1}`, en: `Comment ${i + 1}` },
        kind: "text",
        appliesTo: ["self", "manager"],
        visibleToReviewee: true,
        required: false,
        sort: 10 + i,
        dimension: "strengths",
      })
      .returning({ id: questionRevision.id });
    const [row] = await db
      .insert(answer)
      .values({
        requestId,
        questionRevisionId: question.id,
        textValue: text,
      })
      .returning({ id: answer.id });
    await db.execute(sql`
      insert into qualitative_analysis
        (answer_id, provider, prompt_version, dimension, sentiment, text_hash, source_md5)
      values (${row.id}::uuid, 'mock', 'v1', 'strengths', ${sentiment}::sentiment,
              md5(${text}), md5(${text}))`);
    ids.push(row.id);
  }
  return ids;
}

/** A human correction of the label of an answer (it beats the machine's). */
export async function correctLabel(
  answerId: string,
  sentiment: TestSentiment,
): Promise<void> {
  await db.execute(sql`
    insert into analysis_correction (answer_id, new_sentiment, new_themes)
    values (${answerId}::uuid, ${sentiment}::sentiment, '{}')`);
}

export async function reset() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run, app_setting, admin_audit_log, analysis_correction, qualitative_analysis, analysis_run, theme CASCADE`,
  );
}

// ---------------------------------------------------------------- scenario

/**
 * Two teams and two semesters. In H1 2024 (period 2024-01-01 .. 2024-06-30)
 * every row is: goals "completed/total (in progress, closed, overdue)",
 * retention R, engagement E (the manager's, Likert 1-5; "-" = unanswered).
 * Overdue: in progress and due before 2024-06-30 (due ON it is not overdue).
 *
 *   Ingeniería, manager Marta
 *     Ana     4/5 (1 ip, 0 cl, 0 od)    sum 460    R2 E4
 *     Bruno   1/4 (2 ip, 1 cl, 1 od)    sum 180    R3 E3
 *     Carla   2/2 (0, 0, 0)             sum 200    R5 E5   + one goal "ya no aplica" (ignored)
 *     Dario   no goals                             R3 E3
 *     Elena   3/10 (7 ip, 0, 0)         sum 650    R4 E5
 *     Fabio   4/5 (1 ip, 0, 1 od)       sum 430    R3 E1
 *   Producto, manager Nora
 *     Gina    1/4 (3 ip, 0, 2 od)       sum 130    R5 E4
 *     Hugo    1/1 (0, 0, 0)             sum 100    R4 E4
 *     Iris    1/2 (1 ip, 0, 0)          sum 140    R5 E-
 *
 * Labeled comments (machine label; Bruno has one corrected by a human):
 *   Ana: self positive, constructive; manager positive, negative  -> 2 of 4 positive
 *   Bruno: manager negative (corrected to positive), negative      -> 1 of 2
 *   Gina: manager positive x3                                      -> 3 of 3
 *
 * H2 2024 has Ana alone, with one completed goal (it must never leak into H1).
 * Today (job history) Ana works in Producto under Nora; everybody else is
 * where the H1 snapshot says. A person removed from the cycle (Zoe) has goals
 * and indicators that count nowhere.
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
  zoe: "Zoe Rey",
} as const;
export type Who = keyof typeof names;

const ip = (percent: number, due: string | null = "2024-12-31"): TestGoal => ({
  status: "in_progress",
  percent,
  due,
});
const done = (due = "2024-03-31"): TestGoal => ({
  status: "completed",
  percent: 100,
  due,
});

const GOALS: Partial<Record<Who, TestGoal[]>> = {
  ana: [
    done("2024-03-31"),
    done("2024-05-31"),
    done("2024-06-30"),
    done("2024-06-15"),
    ip(60, "2024-09-30"),
  ],
  bruno: [
    done("2024-04-15"),
    ip(50, "2024-05-01"), // overdue
    ip(20, "2024-06-30"), // due on the last day: not overdue
    { status: "closed", percent: 10, due: "2024-02-01" },
  ],
  carla: [
    done("2024-02-29"),
    done("2024-04-30"),
    {
      status: "in_progress",
      percent: 0,
      due: "2024-01-01",
      noLongerApplicable: true,
    },
  ],
  elena: [...times(3, done("2024-05-31")), ...times(7, ip(50, "2025-01-31"))],
  fabio: [
    ...times(4, done("2024-05-31")),
    ip(30, "2024-06-01"), // overdue
  ],
  gina: [
    ip(0, "2024-01-31"), // overdue
    ip(10, "2024-03-31"), // overdue
    ip(20, null), // no due date: not overdue
    done("2024-06-30"),
  ],
  hugo: [done("2024-06-30")],
  iris: [done("2024-06-30"), ip(40, "2024-12-31")],
  zoe: [done()],
};

type Pair = [number | null, number | null];
const INDICATORS: Partial<Record<Who, Pair>> = {
  ana: [2, 4],
  bruno: [3, 3],
  carla: [5, 5],
  dario: [3, 3],
  elena: [4, 5],
  fabio: [3, 1],
  gina: [5, 4],
  hugo: [4, 4],
  iris: [5, null],
  zoe: [1, 1],
};

const teamOf = (who: Who): Who =>
  (["gina", "hugo", "iris"] as Who[]).includes(who) ? "nora" : "marta";
const departmentOf = (who: Who) =>
  teamOf(who) === "marta" ? "Ingeniería" : "Producto";

export type Scenario = {
  id: Record<Who, string>;
  h1: TestCycle;
  h2: TestCycle;
  /** The participant row of `who` in H1. */
  participant: Record<Who, string>;
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
        validTo: "2024-07-01",
        managerPersonId: id.marta,
        department: "Ingeniería",
      });
      await insertJob({
        personId: id.ana,
        validFrom: "2024-07-01",
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
  const h1 = await insertCycle({
    name: "H1 2024",
    periodStart: "2024-01-01",
    periodEnd: "2024-06-30",
  });
  const h2 = await insertCycle({
    name: "H2 2024",
    periodStart: "2024-07-01",
    periodEnd: "2024-12-31",
  });
  const participant = {} as Record<Who, string>;
  for (const who of Object.keys(GOALS) as Who[]) {
    const participantId = await insertParticipant({
      cycleId: h1.cycleId,
      personId: id[who],
      snapManagerPersonId: id[teamOf(who)],
      snapDepartment: departmentOf(who),
      removed: who === "zoe",
    });
    participant[who] = participantId;
    await insertGoals(participantId, GOALS[who] ?? []);
  }
  // Dario has no goals at all: still a participant.
  participant.dario = await insertParticipant({
    cycleId: h1.cycleId,
    personId: id.dario,
    snapManagerPersonId: id.marta,
    snapDepartment: "Ingeniería",
  });
  for (const [who, [retention, engagement]] of Object.entries(INDICATORS) as [
    Who,
    Pair,
  ][]) {
    await insertReview({
      cycle: h1,
      participantId: participant[who],
      reviewerPersonId: id[teamOf(who)],
      retention,
      engagement,
    });
  }
  // Comments.
  const anaSelf = await insertReview({
    cycle: h1,
    participantId: participant.ana,
    reviewerPersonId: id.ana,
    relationship: "self",
  });
  await insertLabeledComments(h1, anaSelf, ["positive", "constructive"]);
  const [anaManager] = await db
    .select({ id: reviewRequest.id })
    .from(reviewRequest)
    .where(
      sql`${reviewRequest.participantId} = ${participant.ana}::uuid and ${reviewRequest.relationship} = 'manager'`,
    );
  await insertLabeledComments(h1, anaManager.id, ["positive", "negative"]);
  const [brunoManager] = await db
    .select({ id: reviewRequest.id })
    .from(reviewRequest)
    .where(
      sql`${reviewRequest.participantId} = ${participant.bruno}::uuid and ${reviewRequest.relationship} = 'manager'`,
    );
  const [brunoFirst] = await insertLabeledComments(h1, brunoManager.id, [
    "negative",
    "negative",
  ]);
  await correctLabel(brunoFirst, "positive");
  const [ginaManager] = await db
    .select({ id: reviewRequest.id })
    .from(reviewRequest)
    .where(
      sql`${reviewRequest.participantId} = ${participant.gina}::uuid and ${reviewRequest.relationship} = 'manager'`,
    );
  await insertLabeledComments(h1, ginaManager.id, [
    "positive",
    "positive",
    "positive",
  ]);
  // H2: Ana alone, one completed goal.
  const anaH2 = await insertParticipant({
    cycleId: h2.cycleId,
    personId: id.ana,
    snapManagerPersonId: id.nora,
    snapDepartment: "Producto",
  });
  await insertGoals(anaH2, [done("2024-10-31")]);
  await insertReview({
    cycle: h2,
    participantId: anaH2,
    reviewerPersonId: id.nora,
    retention: 5,
    engagement: 5,
  });
  return { id, h1, h2, participant };
}
