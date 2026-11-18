import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { answer, questionRevision } from "@/db/schema";
import {
  as,
  buildScenario,
  direction,
  hr,
  insertIndicatorReview,
  reset,
  type Scenario,
  type TestCycle,
} from "@/modules/analytics/indicators/test-support";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";
import { periodDetail } from "./queries";

let s: Scenario;

const VALUED = [1, 2, 3, 4].map((value) => ({
  value,
  label: { es: `V${value}`, en: `V${value}` },
  normalized: (value - 1) / 3,
}));

/** A self review of `who` in `cycle` with its answer to the valued question (1-4). */
async function selfValued(
  cycle: TestCycle,
  who: keyof Scenario["id"],
  value: number,
) {
  let [q] = await db
    .select({ id: questionRevision.id })
    .from(questionRevision)
    .where(
      and(
        eq(questionRevision.cycleId, cycle.cycleId),
        eq(questionRevision.role, "valued"),
      ),
    );
  if (!q) {
    [q] = await db
      .insert(questionRevision)
      .values({
        cycleId: cycle.cycleId,
        sectionTitle: { es: "Autoevaluación", en: "Self review" },
        prompt: { es: "valued", en: "valued" },
        kind: "rating",
        appliesTo: ["self"],
        visibleToReviewee: true,
        required: false,
        scale: { options: VALUED },
        sort: 5,
        role: "valued",
      })
      .returning({ id: questionRevision.id });
  }
  const requestId = await insertIndicatorReview({
    cycle,
    participantId: s.participant(cycle, who),
    reviewerPersonId: s.id[who],
    relationship: "self",
  });
  await db.insert(answer).values({
    requestId,
    questionRevisionId: q.id,
    optionValue: value,
    optionLabel: `V${value}`,
    normalized: (value - 1) / 3,
  });
}

beforeAll(async () => {
  s = await buildScenario();
  // C1: Ana 4, Bruno 2 (mean 3). C2: Ana 4, Bruno 3, Carla 2, Dario 1, Elena 4 (mean 2.8).
  await selfValued(s.c1, "ana", 4);
  await selfValued(s.c1, "bruno", 2);
  for (const [who, v] of [
    ["ana", 4],
    ["bruno", 3],
    ["carla", 2],
    ["dario", 1],
    ["elena", 4],
  ] as const) {
    await selfValued(s.c2, who, v);
  }
}, 60_000);
afterAll(async () => {
  await reset();
  await closeDb();
});

describe("periodDetail", () => {
  it("People: one row per cycle, oldest first, with completion, means and goals", async () => {
    const { rows, minGroupSize } = await periodDetail(db, hr);

    expect(minGroupSize).toBeNull();
    expect(rows.map((r) => r.cycleName)).toEqual(["H1 2024", "H2 2024"]);
    const [c1, c2] = rows;
    // C1: 6 people (Ana, Bruno, Carla, Elena, Fabio, Gina), manager answers for all; self for two.
    expect(c1).toMatchObject({
      cycleId: s.c1.cycleId,
      periodStart: "2024-01-01",
      periodEnd: "2024-06-30",
      participants: 6,
      managerRate: 1,
      goals: 0,
      goalsCompletedPct: null,
    });
    expect(c1.selfRate).toBeCloseTo(1);
    expect(c1.valued).toEqual({ n: 2, mean: 3 });
    // Retention C1: 4,3,5,4,3,2; engagement: 4,3,4,5,4,2.
    expect(c1.retention?.n).toBe(6);
    expect(c1.retention?.mean).toBeCloseTo(21 / 6);
    expect(c1.engagement?.n).toBe(6);
    expect(c1.engagement?.mean).toBeCloseTo(22 / 6);
    expect(c2).toMatchObject({ participants: 9, managerRate: 1 });
    expect(c2.valued?.n).toBe(5);
    expect(c2.valued?.mean).toBeCloseTo(2.8);
    expect(c2.retention?.mean).toBeCloseTo(28 / 9);
    expect(c2.engagement?.mean).toBeCloseTo(23 / 8);
  });

  it("filters by area, manager and org attributes", async () => {
    await setOrgAttributes(s.id.ana, { account: "Cuenta A" });
    await setOrgAttributes(s.id.bruno, { account: "Cuenta A" });

    const byAccount = await periodDetail(db, hr, { account: "Cuenta A" });
    expect(byAccount.rows.map((r) => r.participants)).toEqual([2, 2]);
    expect(byAccount.rows[0].valued).toEqual({ n: 2, mean: 3 });

    const byDepartment = await periodDetail(db, hr, { department: "Producto" });
    // Ana's snapshot says Ingeniería in both cycles, so Producto is Gina (C1) and Gina, Hugo, Iris (C2).
    expect(byDepartment.rows.map((r) => r.participants)).toEqual([1, 3]);
    const byManager = await periodDetail(db, hr, { managerId: s.id.nora });
    expect(byManager.rows.map((r) => r.participants)).toEqual([1, 3]);
  });

  it("a manager reads their direct reports of each cycle, never themself", async () => {
    const { rows } = await periodDetail(db, as(s.id.nora, "manager"));
    expect(rows.map((r) => r.participants)).toEqual([1, 3]);
    expect(rows[1].retention?.n).toBe(3);
    expect(rows[1].valued).toBeNull();
  });

  it("direction: no filters, figures of a cycle under the minimum hidden, the head count kept", async () => {
    const { rows, minGroupSize } = await periodDetail(db, direction, {
      department: "Producto",
    });

    expect(minGroupSize).toBe(5);
    // The filter is ignored: whole cycles.
    expect(rows.map((r) => r.participants)).toEqual([6, 9]);
    // C1 valued has 2 people: hidden. C2 has 5: shown.
    expect(rows[0].valued).toBeNull();
    expect(rows[1].valued?.n).toBe(5);
    expect(rows[1].retention?.n).toBe(9);

    const strict = await periodDetail(db, direction, { minGroupSize: 7 });
    expect(strict.rows[0]).toMatchObject({
      participants: 6,
      selfRate: null,
      managerRate: null,
      valued: null,
      retention: null,
      engagement: null,
      goalsCompletedPct: null,
    });
    expect(strict.rows[1].retention?.n).toBe(9);
    expect(strict.rows[1].valued).toBeNull();
  });

  it("forbids employees and a manager without a person", async () => {
    for (const actor of [as(s.id.ana, "employee"), as("", "manager")]) {
      await expect(periodDetail(db, actor)).rejects.toBeDefined();
    }
  });
});
