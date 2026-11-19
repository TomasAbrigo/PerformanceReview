/**
 * Data entered in the app (native: captured reviews, goals created here) is
 * counted by every insights view and by the Arturía export, like imported
 * data is (#106).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { goal, reviewCycle, reviewRequest } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import { completionSummary } from "@/modules/analytics/completion";
import { goalKpis } from "@/modules/analytics/goals-insights";
import { indicatorDistribution } from "@/modules/analytics/indicators";
import { buildReport } from "@/modules/arturia-report/build";
import { createGoal } from "@/modules/goals/write";
import { listTemplates } from "@/modules/templates";
import { MockProvider } from "@/modules/qualitative-analysis/mock-provider";
import { sentimentTotals } from "@/modules/qualitative-analysis/queries";
import { runAnalysis } from "@/modules/qualitative-analysis/service";
import { questionsFor } from "@/modules/review-core/answers";
import {
  createTestCycle,
  loadPeople,
  participantOf,
  people,
  requestIdOf,
  systemTemplateId,
} from "@/modules/review-core/test-support";
import { saveDraft, submit } from "@/modules/review-capture/service";
import type { CaptureAnswer } from "@/modules/review-capture/rules";

const hr: ActorContext = { personId: null, role: "hr" };
let cycleId: string;

/** A valid answer for every question of a form: the highest rating, text otherwise. */
async function fullAnswers(rel: "self" | "manager"): Promise<CaptureAnswer[]> {
  const qs = await questionsFor(db, cycleId, null, rel);
  return qs.map((q) => ({
    questionRevisionId: q.id,
    value:
      q.kind === "rating"
        ? q.scale!.options.at(-1)!.value
        : q.kind === "single_choice"
          ? q.choices![0].value
          : `Muy buen semestre, aprendí mucho (${rel} ${q.sort})`,
  }));
}

beforeAll(async () => {
  await loadPeople();
  await db.execute(sql`delete from goal`);
  // The Santex template is the one whose manager form has the retention and
  // engagement Likert questions (role retention / engagement).
  await systemTemplateId();
  const santex = (await listTemplates(db)).find(
    (t) => t.systemKey === "santex_semester",
  )!;
  // Bruno reports to Carla at the snapshot (2022-06-01). The period covers
  // today: a native goal starts the day it is created and only belongs to
  // the cycles whose period it overlaps (goalOverlapsPeriod).
  const cycle = await createTestCycle({
    templateId: santex.id,
    personIds: [people.bruno],
    periodStart: "2026-01-01",
    periodEnd: "2027-06-30",
  });
  cycleId = cycle.id;
  const p = await participantOf(cycleId, people.bruno);
  const bruno: ActorContext = { personId: people.bruno, role: "employee" };
  const selfId = await requestIdOf(p.id, "self");
  const managerId = await requestIdOf(p.id, "manager");
  await saveDraft(db, bruno, selfId, await fullAnswers("self"));
  await submit(db, bruno, selfId);
  // Carla is no longer Bruno's manager today, so she may not answer (#104):
  // People complete the manager review.
  await saveDraft(db, hr, managerId, await fullAnswers("manager"));
  await submit(db, hr, managerId);
  // A goal created in the app while the cycle runs reaches its snapshot.
  await createGoal(db, hr, {
    personId: people.bruno,
    title: "Goal nativo",
    dueDate: "2027-03-31",
  });
});

afterAll(async () => {
  await db.delete(reviewCycle);
  await db.execute(sql`delete from goal`);
  await closeDb();
});

describe("native data in the insights", () => {
  it("is native data", async () => {
    const reqs = await db
      .select()
      .from(reviewRequest)
      .where(eq(reviewRequest.cycleId, cycleId));
    expect(reqs.every((r) => r.sourceSystem === "native")).toBe(true);
    const goals = await db.select().from(goal);
    expect(goals.map((g) => g.sourceSystem)).toEqual(["native"]);
  });

  it("completion counts the submitted self and manager reviews", async () => {
    const s = await completionSummary(db, hr, { cycleId });
    expect(s.participants).toBe(1);
    expect(s.total).toMatchObject({
      selfSubmitted: 1,
      selfApplicable: 1,
      managerSubmitted: 1,
      managerApplicable: 1,
    });
  });

  it("indicators count the manager's Likert answers", async () => {
    for (const indicator of ["retention", "engagement"] as const) {
      const d = await indicatorDistribution(db, hr, {
        cycleId,
        indicator,
        groupBy: "none",
      });
      expect(d.total?.n, indicator).toBe(1);
    }
  });

  it("analysis labels the native open-text answers and sentiment counts them", async () => {
    const run = await runAnalysis(db, {
      cycleId,
      provider: new MockProvider(),
    });
    expect(run.total).toBeGreaterThan(0);
    expect(run.analyzed).toBe(run.total);
    const totals = await sentimentTotals(db, hr, { cycleId });
    expect(totals?.total).toBe(run.total);
  });

  it("goal KPIs count the native goal of the cycle snapshot", async () => {
    const k = await goalKpis(db, hr, { cycleId, groupBy: "person" });
    expect(k.total).toMatchObject({ peopleWithGoals: 1, goals: 1 });
  });

  it("the Arturía export includes the native cycle", async () => {
    const r = await buildReport(db, { cycle: cycleId, anonymized: false });
    expect(r.cycle.id).toBe(cycleId);
    const s = r.sections;
    expect(s.completion).not.toBeNull();
    expect(s.indicators).not.toBeNull();
    expect(s.qualitative).not.toBeNull();
    expect(s.goals).not.toBeNull();
    expect(s.completion?.byRelationship).toEqual([
      expect.objectContaining({ relationship: "self", submitted: 1 }),
      expect.objectContaining({ relationship: "manager", submitted: 1 }),
    ]);
    for (const d of s.indicators!.distribution) {
      expect(d.total?.n, d.indicator).toBe(1);
    }
    expect(s.qualitative?.people).toBeGreaterThan(0);
    // The template's yes/no questions have no dimension: the report keys them by what they ask.
    for (const row of s.qualitative!.yesNo.rows) {
      expect(row.dimension).toMatch(/^yes_no_[a-z0-9_]+$/);
    }
    expect(s.goals).toMatchObject({ participantsWithGoals: 1, goals: 1 });
  });
});
