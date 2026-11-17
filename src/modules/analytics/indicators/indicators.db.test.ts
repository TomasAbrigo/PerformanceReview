import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  insertParticipant,
  insertPerson,
} from "@/modules/analytics/test-support";
import { ReviewError } from "@/modules/review-core/review-errors";
import { setSetting } from "@/modules/settings";
import {
  indicatorAlerts,
  indicatorConfig,
  indicatorCycles,
  indicatorDistribution,
  indicatorFilterOptions,
  indicatorOverview,
  indicatorSubjects,
  indicatorTrend,
  indicatorTrendOverview,
  riskMatrix,
} from ".";
import {
  as,
  buildScenario,
  direction,
  hr,
  insertIndicatorCycle,
  insertIndicatorQuestion,
  insertIndicatorReview,
  names,
  reset,
  type Scenario,
  type TestCycle,
} from "./test-support";

let id: Scenario["id"];
let c1: TestCycle;
let c2: TestCycle;
let participant: Scenario["participant"];

beforeEach(async () => {
  ({ id, c1, c2, participant } = await buildScenario());
});

afterAll(async () => {
  await reset();
  await closeDb();
});

const marta = () => as(id.marta, "manager");
const nora = () => as(id.nora, "manager");
const forbidden = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ReviewError);
  expect((error as ReviewError).code).toBe("forbidden");
};

describe("indicatorDistribution", () => {
  it("counts the values 1-5 per area with n and mean (retention, H2 2024)", async () => {
    const d = await indicatorDistribution(db, hr, {
      cycleId: c2.cycleId,
      indicator: "retention",
      groupBy: "department",
    });
    expect(d.series.map((s) => [s.key, s.counts, s.n])).toEqual([
      ["Ingeniería", [1, 2, 1, 1, 1], 6],
      ["Producto", [0, 1, 0, 1, 1], 3],
    ]);
    expect(d.series[0].mean).toBeCloseTo(17 / 6);
    expect(d.series[1].mean).toBeCloseTo(11 / 3);
    expect(d.total).toMatchObject({ counts: [1, 3, 1, 2, 2], n: 9 });
    expect(d.total!.mean).toBeCloseTo(28 / 9);
    expect(d.suppressed).toBe(0);
  });

  it("engagement counts only the people who answered it", async () => {
    const d = await indicatorDistribution(db, hr, {
      cycleId: c2.cycleId,
      indicator: "engagement",
      groupBy: "none",
    });
    // Iris Cano has no engagement answer.
    expect(d.series).toHaveLength(1);
    expect(d.series[0]).toMatchObject({
      key: null,
      counts: [1, 3, 1, 2, 1],
      n: 8,
    });
    expect(d.series[0].mean).toBeCloseTo(23 / 8);
  });

  it("groups by the snapshot manager, with the manager's name", async () => {
    const d = await indicatorDistribution(db, hr, {
      cycleId: c1.cycleId,
      indicator: "engagement",
      groupBy: "manager",
    });
    expect(d.series.map((s) => [s.key, s.label, s.counts, s.n])).toEqual([
      [id.marta, names.marta, [0, 0, 1, 3, 1], 5],
      [id.nora, names.nora, [0, 1, 0, 0, 0], 1],
    ]);
  });

  it("reads the hierarchy as of the snapshot or as of today", async () => {
    const asOf = await indicatorDistribution(db, hr, {
      cycleId: c2.cycleId,
      indicator: "retention",
      groupBy: "department",
      hierarchy: "asOf",
    });
    const current = await indicatorDistribution(db, hr, {
      cycleId: c2.cycleId,
      indicator: "retention",
      groupBy: "department",
      hierarchy: "current",
    });
    expect(asOf.series.map((s) => [s.key, s.n])).toEqual([
      ["Ingeniería", 6],
      ["Producto", 3],
    ]);
    // Ana Prieto (retention 2) moved to Producto.
    expect(current.series.map((s) => [s.key, s.counts, s.n])).toEqual([
      ["Ingeniería", [1, 1, 1, 1, 1], 5],
      ["Producto", [0, 2, 0, 1, 1], 4],
    ]);
  });

  it("filters by area and manager", async () => {
    const d = await indicatorDistribution(db, hr, {
      cycleId: c2.cycleId,
      indicator: "retention",
      groupBy: "none",
      filters: { department: "Producto" },
    });
    expect(d.total).toMatchObject({ counts: [0, 1, 0, 1, 1], n: 3 });
    const byManager = await indicatorDistribution(db, hr, {
      cycleId: c2.cycleId,
      indicator: "retention",
      groupBy: "none",
      filters: { managerId: id.marta },
    });
    expect(byManager.total).toMatchObject({ n: 6 });
  });

  it("an empty cycle has no series and a zero total", async () => {
    const empty = await insertIndicatorCycle({
      name: "H1 2025",
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
    });
    const d = await indicatorDistribution(db, hr, {
      cycleId: empty.cycleId,
      indicator: "retention",
      groupBy: "department",
    });
    expect(d.series).toEqual([]);
    expect(d.total).toMatchObject({
      counts: [0, 0, 0, 0, 0],
      n: 0,
      mean: null,
    });
  });

  it("uses only submitted manager reviews of active participants in launched cycles", async () => {
    // Noise that must not count: a draft manager review, a self review that
    // answers the same questions, a deleted review, a removed participant, an
    // answer outside 1-5 and a draft cycle.
    await insertIndicatorReview({
      cycle: c2,
      participantId: participant(c2, "dario"),
      reviewerPersonId: id.nora,
      retention: 1,
      engagement: 1,
      status: "draft",
    });
    await insertIndicatorReview({
      cycle: c2,
      participantId: participant(c2, "dario"),
      reviewerPersonId: id.dario,
      relationship: "self",
      retention: 1,
      engagement: 1,
    });
    await insertIndicatorReview({
      cycle: c2,
      participantId: participant(c2, "hugo"),
      reviewerPersonId: id.marta,
      retention: 1,
      engagement: 1,
      deleted: true,
    });
    const removed = await insertParticipant({
      cycleId: c2.cycleId,
      personId: id.marta,
      snapManagerPersonId: id.nora,
      snapDepartment: "Producto",
      removed: true,
    });
    await insertIndicatorReview({
      cycle: c2,
      participantId: removed,
      reviewerPersonId: id.nora,
      retention: 1,
      engagement: 1,
    });
    const odd = await insertParticipant({
      cycleId: c2.cycleId,
      personId: id.nora,
      snapManagerPersonId: id.marta,
    });
    await insertIndicatorReview({
      cycle: c2,
      participantId: odd,
      reviewerPersonId: id.marta,
      retention: 7,
      engagement: 0,
    });
    const draftCycle = await insertIndicatorCycle({
      name: "Borrador",
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
      status: "draft",
    });
    const p = await insertParticipant({
      cycleId: draftCycle.cycleId,
      personId: id.ana,
    });
    await insertIndicatorReview({
      cycle: draftCycle,
      participantId: p,
      reviewerPersonId: id.marta,
      retention: 1,
      engagement: 1,
    });
    const d = await indicatorDistribution(db, hr, {
      cycleId: c2.cycleId,
      indicator: "retention",
      groupBy: "none",
    });
    expect(d.total).toMatchObject({ counts: [1, 3, 1, 2, 2], n: 9 });
    const draft = await indicatorDistribution(db, hr, {
      cycleId: draftCycle.cycleId,
      indicator: "retention",
      groupBy: "none",
    });
    expect(draft.total!.n).toBe(0);
  });

  it("counts a person once when two managers submitted: the latest review wins", async () => {
    await insertIndicatorReview({
      cycle: c2,
      participantId: participant(c2, "dario"),
      reviewerPersonId: id.nora,
      retention: 5,
      engagement: 5,
      submittedAt: new Date("2000-01-01"),
    });
    const d = await indicatorDistribution(db, hr, {
      cycleId: c2.cycleId,
      indicator: "retention",
      groupBy: "none",
    });
    expect(d.total).toMatchObject({ counts: [1, 3, 1, 2, 2], n: 9 });
  });

  describe("authorization", () => {
    it("a manager sees the distribution of their direct reports only", async () => {
      const mine = await indicatorDistribution(db, marta(), {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "department",
      });
      expect(mine.series.map((s) => [s.key, s.counts, s.n])).toEqual([
        ["Ingeniería", [1, 2, 1, 1, 1], 6],
      ]);
      expect(mine.total).toMatchObject({ n: 6 });
      expect(mine.suppressed).toBe(0);
      // Small teams are not hidden from their own manager.
      const small = await indicatorDistribution(db, nora(), {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "manager",
      });
      expect(small.series.map((s) => [s.label, s.n])).toEqual([
        [names.nora, 3],
      ]);
    });

    it("a filter cannot widen a manager's reach", async () => {
      const d = await indicatorDistribution(db, marta(), {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "none",
        filters: { managerId: id.nora },
      });
      expect(d.total!.n).toBe(0);
      // The scope is the snapshot even when the view reads today's hierarchy:
      // Ana Prieto is Marta's report at the snapshot though she moved.
      const current = await indicatorDistribution(db, marta(), {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "none",
        hierarchy: "current",
      });
      expect(current.total!.n).toBe(6);
    });

    it("a manager never reads about themself, even if the data makes them their own manager", async () => {
      const own = await insertParticipant({
        cycleId: c2.cycleId,
        personId: id.nora,
        snapManagerPersonId: id.nora,
        snapDepartment: "Producto",
      });
      await insertIndicatorReview({
        cycle: c2,
        participantId: own,
        reviewerPersonId: id.nora,
        retention: 1,
        engagement: 1,
      });
      const mine = await indicatorDistribution(db, nora(), {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "none",
      });
      // Still the three people of Producto: Gina, Hugo and Iris.
      expect(mine.total).toMatchObject({ counts: [0, 1, 0, 1, 1], n: 3 });
      const alerts = await indicatorAlerts(db, nora(), { cycleId: c2.cycleId });
      expect(alerts.alerts.map((a) => a.person.name)).toEqual([names.gina]);
      // People see it.
      const all = await indicatorDistribution(db, hr, {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "none",
      });
      expect(all.total!.n).toBe(10);
    });

    it("an employee, even about themself, and a manager without a person are forbidden", async () => {
      const input = {
        cycleId: c2.cycleId,
        indicator: "retention" as const,
        groupBy: "none" as const,
      };
      await forbidden(indicatorDistribution(db, as(id.ana, "employee"), input));
      await forbidden(
        indicatorDistribution(db, { personId: null, role: "manager" }, input),
      );
      await forbidden(
        indicatorDistribution(db, as(id.marta, "employee"), input),
      );
    });

    it("direction sees only groups of at least the minimum (5)", async () => {
      const d = await indicatorDistribution(db, direction, {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "department",
      });
      // Producto (3) is hidden, and so is the total (it would give it away).
      expect(d.series.map((s) => [s.key, s.n])).toEqual([["Ingeniería", 6]]);
      expect(d.suppressed).toBe(3);
      expect(d.total).toBeNull();
      expect(d.minGroupSize).toBe(5);
      const whole = await indicatorDistribution(db, direction, {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "none",
      });
      expect(whole.total).toMatchObject({ n: 9 });
      expect(whole.suppressed).toBe(0);
    });

    it("direction: groups under the minimum fold into 'others', which is hidden if still too small", async () => {
      const folded = await indicatorDistribution(db, direction, {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "department",
        config: { minGroupSize: 7 },
      });
      // 6 and 3 are both under 7: together they make a group of 9.
      expect(folded.series).toHaveLength(1);
      expect(folded.series[0]).toMatchObject({
        others: true,
        key: null,
        counts: [1, 3, 1, 2, 2],
        n: 9,
      });
      expect(folded.suppressed).toBe(0);
      const hidden = await indicatorDistribution(db, direction, {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "department",
        config: { minGroupSize: 10 },
      });
      expect(hidden.series).toEqual([]);
      expect(hidden.suppressed).toBe(9);
      expect(hidden.total).toBeNull();
    });
  });
});

describe("indicatorTrend", () => {
  const shape = (t: Awaited<ReturnType<typeof indicatorTrend>>) =>
    t.points.map((p) => [p.cycleName, p.n, p.counts, p.suppressed]);

  it("the whole organisation, cycle by cycle in period order", async () => {
    const t = await indicatorTrend(db, hr, { indicator: "retention" });
    expect(t.subject).toEqual({ kind: "all" });
    expect(shape(t)).toEqual([
      ["H1 2024", 6, [0, 1, 2, 2, 1], false],
      ["H2 2024", 9, [1, 3, 1, 2, 2], false],
    ]);
    expect(t.points[0].mean).toBeCloseTo(3.5);
    expect(t.points[1].mean).toBeCloseTo(28 / 9);
  });

  it("a team: the snapshot manager's people in each cycle", async () => {
    const t = await indicatorTrend(db, hr, {
      indicator: "retention",
      managerId: id.marta,
    });
    expect(t.subject).toEqual({
      kind: "manager",
      managerId: id.marta,
      name: names.marta,
    });
    expect(shape(t)).toEqual([
      ["H1 2024", 5, [0, 0, 2, 2, 1], false],
      ["H2 2024", 6, [1, 2, 1, 1, 1], false],
    ]);
    expect(t.points[0].mean).toBeCloseTo(3.8);
    expect(t.points[1].mean).toBeCloseTo(17 / 6);
  });

  it("an area", async () => {
    const t = await indicatorTrend(db, hr, {
      indicator: "engagement",
      department: "Producto",
    });
    expect(t.subject).toEqual({ kind: "department", department: "Producto" });
    expect(shape(t)).toEqual([
      ["H1 2024", 1, [0, 1, 0, 0, 0], false],
      ["H2 2024", 2, [0, 1, 0, 1, 0], false],
    ]);
  });

  it("a person: one value per cycle they were in", async () => {
    const t = await indicatorTrend(db, hr, {
      indicator: "retention",
      personId: id.ana,
    });
    expect(t.subject).toEqual({
      kind: "person",
      personId: id.ana,
      name: names.ana,
    });
    expect(t.points.map((p) => [p.cycleName, p.n, p.mean])).toEqual([
      ["H1 2024", 1, 4],
      ["H2 2024", 1, 2],
    ]);
    // Dario Mena joined in H2 2024.
    const dario = await indicatorTrend(db, hr, {
      indicator: "retention",
      personId: id.dario,
    });
    expect(dario.points.map((p) => p.cycleName)).toEqual(["H2 2024"]);
  });

  it("rejects an unknown person and more than one subject", async () => {
    await expect(
      indicatorTrend(db, hr, {
        indicator: "retention",
        personId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      indicatorTrend(db, hr, {
        indicator: "retention",
        personId: id.ana,
        managerId: id.marta,
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  describe("authorization", () => {
    it("a manager sees their team (by default) and each direct report", async () => {
      const team = await indicatorTrend(db, marta(), {
        indicator: "retention",
      });
      expect(team.subject).toMatchObject({ kind: "all" });
      expect(shape(team)).toEqual([
        ["H1 2024", 5, [0, 0, 2, 2, 1], false],
        ["H2 2024", 6, [1, 2, 1, 1, 1], false],
      ]);
      const own = await indicatorTrend(db, marta(), {
        indicator: "retention",
        managerId: id.marta,
      });
      expect(shape(own)).toEqual(shape(team));
      const report = await indicatorTrend(db, marta(), {
        indicator: "engagement",
        personId: id.elena,
      });
      expect(report.points.map((p) => p.mean)).toEqual([5, 2]);
    });

    it("a manager cannot read a person who is not their report, nor another team", async () => {
      await forbidden(
        indicatorTrend(db, marta(), {
          indicator: "retention",
          personId: id.gina,
        }),
      );
      await forbidden(
        indicatorTrend(db, marta(), {
          indicator: "retention",
          managerId: id.nora,
        }),
      );
      // An area filter stays inside the manager's reports.
      const other = await indicatorTrend(db, marta(), {
        indicator: "retention",
        department: "Producto",
      });
      expect(other.points).toEqual([]);
    });

    it("a manager reads a person only in the cycles where they were their direct report", async () => {
      // Jana Moya reported to Nora in H1 2024 and to Marta in H2 2024.
      const jana = await insertPerson({
        displayName: "Jana Moya",
        noEmployment: true,
      });
      for (const [cycle, manager, department, retention] of [
        [c1, id.nora, "Producto", 5],
        [c2, id.marta, "Ingeniería", 3],
      ] as const) {
        const p = await insertParticipant({
          cycleId: cycle.cycleId,
          personId: jana,
          snapManagerPersonId: manager,
          snapDepartment: department,
        });
        await insertIndicatorReview({
          cycle,
          participantId: p,
          reviewerPersonId: manager,
          retention,
          engagement: 4,
        });
      }
      const asMarta = await indicatorTrend(db, marta(), {
        indicator: "retention",
        personId: jana,
      });
      expect(asMarta.points.map((p) => [p.cycleName, p.mean])).toEqual([
        ["H2 2024", 3],
      ]);
      const asNora = await indicatorTrend(db, nora(), {
        indicator: "retention",
        personId: jana,
      });
      expect(asNora.points.map((p) => [p.cycleName, p.mean])).toEqual([
        ["H1 2024", 5],
      ]);
      const asHr = await indicatorTrend(db, hr, {
        indicator: "retention",
        personId: jana,
      });
      expect(asHr.points.map((p) => [p.cycleName, p.mean])).toEqual([
        ["H1 2024", 5],
        ["H2 2024", 3],
      ]);
    });

    it("an employee is forbidden, also about themself", async () => {
      await forbidden(
        indicatorTrend(db, as(id.ana, "employee"), {
          indicator: "retention",
          personId: id.ana,
        }),
      );
      await forbidden(
        indicatorTrend(db, as(id.ana, "employee"), { indicator: "retention" }),
      );
    });

    it("direction reads aggregates only, and cycles under the minimum are suppressed", async () => {
      await forbidden(
        indicatorTrend(db, direction, {
          indicator: "retention",
          personId: id.ana,
        }),
      );
      const team = await indicatorTrend(db, direction, {
        indicator: "retention",
        managerId: id.marta,
      });
      // Marta's team: 5 in H1 (the minimum), 6 in H2.
      expect(shape(team)).toEqual([
        ["H1 2024", 5, [0, 0, 2, 2, 1], false],
        ["H2 2024", 6, [1, 2, 1, 1, 1], false],
      ]);
      const small = await indicatorTrend(db, direction, {
        indicator: "retention",
        department: "Producto",
      });
      // Producto: 1 in H1, 3 in H2: nothing to show.
      expect(
        small.points.map((p) => [
          p.cycleName,
          p.n,
          p.mean,
          p.counts,
          p.suppressed,
        ]),
      ).toEqual([
        ["H1 2024", null, null, null, true],
        ["H2 2024", null, null, null, true],
      ]);
      expect(small.minGroupSize).toBe(5);
    });
  });
});

describe("riskMatrix", () => {
  const cell = (
    m: Awaited<ReturnType<typeof riskMatrix>>,
    retention: string,
    engagement: string,
  ) =>
    m.cells.find(
      (c) => c.retention === retention && c.engagement === engagement,
    )!;

  it("counts people by retention × engagement band, and lists the risk quadrant for People", async () => {
    const m = await riskMatrix(db, hr, { cycleId: c2.cycleId });
    // Bands with the risk threshold 2: low 1-2, mid 3, high 4-5. Iris Cano
    // has no engagement answer, so she is not in the matrix.
    expect(m.cells).toHaveLength(9);
    expect(m.total).toBe(8);
    expect(cell(m, "low", "low")).toMatchObject({ count: 3, risk: true });
    expect(cell(m, "low", "high")).toMatchObject({ count: 1, risk: false });
    expect(cell(m, "high", "high")).toMatchObject({ count: 2, risk: false });
    expect(cell(m, "mid", "mid")).toMatchObject({ count: 1, risk: false });
    expect(cell(m, "high", "low")).toMatchObject({ count: 1, risk: false });
    expect(m.cells.reduce((sum, c) => sum + (c.count ?? 0), 0)).toBe(8);
    expect(m.riskCount).toBe(3);
    // Lowest first, then by name.
    expect(m.atRisk).toEqual([
      {
        personId: id.fabio,
        name: names.fabio,
        managerId: id.marta,
        managerName: names.marta,
        department: "Ingeniería",
        retention: 1,
        engagement: 1,
      },
      {
        personId: id.bruno,
        name: names.bruno,
        managerId: id.marta,
        managerName: names.marta,
        department: "Ingeniería",
        retention: 2,
        engagement: 2,
      },
      {
        personId: id.gina,
        name: names.gina,
        managerId: id.nora,
        managerName: names.nora,
        department: "Producto",
        retention: 2,
        engagement: 2,
      },
    ]);
  });

  it("the risk threshold moves the bands", async () => {
    const m = await riskMatrix(db, hr, {
      cycleId: c2.cycleId,
      config: { riskThreshold: 3 },
    });
    // low 1-3, high 4-5: Dario Mena (3,3) joins the risk quadrant.
    expect(cell(m, "low", "low")).toMatchObject({ count: 4, risk: true });
    expect(m.riskCount).toBe(4);
    expect(m.atRisk!.map((p) => p.name)).toEqual([
      names.fabio,
      names.bruno,
      names.gina,
      names.dario,
    ]);
    const strict = await riskMatrix(db, hr, {
      cycleId: c2.cycleId,
      config: { riskThreshold: 1 },
    });
    expect(strict.atRisk!.map((p) => p.name)).toEqual([names.fabio]);
  });

  it("filters by area and manager", async () => {
    const m = await riskMatrix(db, hr, {
      cycleId: c2.cycleId,
      filters: { department: "Producto" },
    });
    expect(m.total).toBe(2);
    expect(m.atRisk!.map((p) => p.name)).toEqual([names.gina]);
    const byManager = await riskMatrix(db, hr, {
      cycleId: c2.cycleId,
      filters: { managerId: id.marta },
    });
    expect(byManager.total).toBe(6);
  });

  describe("authorization", () => {
    it("a manager gets the counts and the named list of their direct reports, like their alerts", async () => {
      const m = await riskMatrix(db, marta(), { cycleId: c2.cycleId });
      expect(m.total).toBe(6);
      expect(cell(m, "low", "low")).toMatchObject({ count: 2, risk: true });
      expect(m.riskCount).toBe(2);
      expect(m.atRisk!.map((p) => p.name)).toEqual([names.fabio, names.bruno]);
      const other = await riskMatrix(db, nora(), { cycleId: c2.cycleId });
      expect(other.total).toBe(2);
      expect(other.atRisk!.map((p) => p.name)).toEqual([names.gina]);
      // The same people their alerts name.
      const alerts = await indicatorAlerts(db, marta(), {
        cycleId: c2.cycleId,
      });
      expect(
        alerts.alerts
          .filter((a) => a.kind === "risk")
          .map((a) => a.person.name),
      ).toEqual(m.atRisk!.map((p) => p.name).sort());
    });

    it("an employee is forbidden", async () => {
      await forbidden(
        riskMatrix(db, as(id.fabio, "employee"), { cycleId: c2.cycleId }),
      );
    });

    it("direction sees cells of at least the minimum only; the total goes with them", async () => {
      const m = await riskMatrix(db, direction, { cycleId: c2.cycleId });
      expect(m.atRisk).toBeNull();
      expect(m.suppressed).toBe(true);
      expect(m.total).toBeNull();
      expect(m.riskCount).toBeNull();
      expect(cell(m, "low", "low").count).toBeNull();
      // An empty cell is not a small one.
      expect(cell(m, "low", "mid").count).toBe(0);
      const open = await riskMatrix(db, direction, {
        cycleId: c2.cycleId,
        config: { minGroupSize: 1 },
      });
      expect(open.suppressed).toBe(false);
      expect(open.total).toBe(8);
      expect(open.riskCount).toBe(3);
      expect(open.atRisk).toBeNull();
    });
  });
});

describe("indicatorAlerts", () => {
  const brief = (a: Awaited<ReturnType<typeof indicatorAlerts>>) =>
    a.alerts.map((x) =>
      x.kind === "risk"
        ? ["risk", x.person.name, x.retention, x.engagement]
        : [
            "drop",
            x.person.name,
            x.indicator,
            x.previousValue,
            x.value,
            x.delta,
          ],
    );

  it("falls of 2+ points since the previous cycle and both indicators at 2 or less", async () => {
    const a = await indicatorAlerts(db, hr, { cycleId: c2.cycleId });
    expect(a.dropThreshold).toBe(2);
    expect(a.riskThreshold).toBe(2);
    // Risk first, then by name and indicator. Bruno Soler fell by 1 only.
    expect(brief(a)).toEqual([
      ["risk", names.bruno, 2, 2],
      ["risk", names.fabio, 1, 1],
      ["risk", names.gina, 2, 2],
      ["drop", names.ana, "retention", 4, 2, 2],
      ["drop", names.elena, "engagement", 5, 2, 3],
      ["drop", names.fabio, "retention", 3, 1, 2],
      ["drop", names.fabio, "engagement", 4, 1, 3],
    ]);
    expect(a.peopleWithDrop).toBe(3);
    expect(a.peopleAtRisk).toBe(3);
    const drop = a.alerts.find(
      (x) => x.kind === "drop" && x.person.name === names.ana,
    )!;
    expect(drop).toMatchObject({
      previousCycleId: c1.cycleId,
      previousCycleName: "H1 2024",
      person: {
        personId: id.ana,
        managerId: id.marta,
        managerName: names.marta,
        department: "Ingeniería",
      },
    });
  });

  it("the first cycle has no drops (nothing before it)", async () => {
    const a = await indicatorAlerts(db, hr, { cycleId: c1.cycleId });
    expect(brief(a)).toEqual([["risk", names.gina, 2, 2]]);
  });

  it("compares with the previous cycle the person has a value in, not only the adjacent one", async () => {
    const h1 = await insertIndicatorCycle({
      name: "H1 2025",
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
    });
    // Hugo Sosa: 4 in H2 2024; H1 2025 he answers retention 2 (fell by 2).
    const p = await insertParticipant({
      cycleId: h1.cycleId,
      personId: id.hugo,
      snapManagerPersonId: id.nora,
      snapDepartment: "Producto",
    });
    await insertIndicatorReview({
      cycle: h1,
      participantId: p,
      reviewerPersonId: id.nora,
      retention: 2,
      engagement: null,
    });
    const a = await indicatorAlerts(db, hr, { cycleId: h1.cycleId });
    expect(brief(a)).toEqual([["drop", names.hugo, "retention", 4, 2, 2]]);
  });

  it("the thresholds change the alerts", async () => {
    const loose = await indicatorAlerts(db, hr, {
      cycleId: c2.cycleId,
      config: { dropThreshold: 1 },
    });
    expect(
      loose.alerts.filter((x) => x.kind === "drop").map((x) => x.person.name),
    ).toEqual([
      names.ana,
      names.bruno,
      names.bruno,
      names.elena,
      names.fabio,
      names.fabio,
    ]);
    const tight = await indicatorAlerts(db, hr, {
      cycleId: c2.cycleId,
      config: { dropThreshold: 3 },
    });
    expect(
      tight.alerts.filter((x) => x.kind === "drop").map((x) => x.person.name),
    ).toEqual([names.elena, names.fabio]);
    const riskier = await indicatorAlerts(db, hr, {
      cycleId: c2.cycleId,
      config: { riskThreshold: 3 },
    });
    expect(riskier.peopleAtRisk).toBe(4);
    const safer = await indicatorAlerts(db, hr, {
      cycleId: c2.cycleId,
      config: { riskThreshold: 1 },
    });
    expect(safer.alerts.filter((x) => x.kind === "risk")).toHaveLength(1);
  });

  describe("authorization", () => {
    it("a manager gets the alerts of their direct reports, with the person", async () => {
      const a = await indicatorAlerts(db, marta(), { cycleId: c2.cycleId });
      expect(brief(a)).toEqual([
        ["risk", names.bruno, 2, 2],
        ["risk", names.fabio, 1, 1],
        ["drop", names.ana, "retention", 4, 2, 2],
        ["drop", names.elena, "engagement", 5, 2, 3],
        ["drop", names.fabio, "retention", 3, 1, 2],
        ["drop", names.fabio, "engagement", 4, 1, 3],
      ]);
      const other = await indicatorAlerts(db, nora(), { cycleId: c2.cycleId });
      expect(brief(other)).toEqual([["risk", names.gina, 2, 2]]);
    });

    it("a manager does not get a drop measured against a cycle where the person was not their report", async () => {
      // Jana Moya: 5 with Nora in H1 2024, 3 with Marta in H2 2024.
      const jana = await insertPerson({
        displayName: "Jana Moya",
        noEmployment: true,
      });
      for (const [cycle, manager, retention] of [
        [c1, id.nora, 5],
        [c2, id.marta, 3],
      ] as const) {
        const p = await insertParticipant({
          cycleId: cycle.cycleId,
          personId: jana,
          snapManagerPersonId: manager,
        });
        await insertIndicatorReview({
          cycle,
          participantId: p,
          reviewerPersonId: manager,
          retention,
          engagement: 4,
        });
      }
      const asHr = await indicatorAlerts(db, hr, { cycleId: c2.cycleId });
      expect(brief(asHr).filter((x) => x[1] === "Jana Moya")).toEqual([
        ["drop", "Jana Moya", "retention", 5, 3, 2],
      ]);
      const asMarta = await indicatorAlerts(db, marta(), {
        cycleId: c2.cycleId,
      });
      expect(brief(asMarta).filter((x) => x[1] === "Jana Moya")).toEqual([]);
    });

    it("an employee is forbidden", async () => {
      await forbidden(
        indicatorAlerts(db, as(id.fabio, "employee"), { cycleId: c2.cycleId }),
      );
    });

    it("direction gets counts, no people, and nothing under the minimum", async () => {
      const a = await indicatorAlerts(db, direction, { cycleId: c2.cycleId });
      expect(a.alerts).toEqual([]);
      // 3 people with a drop and 3 at risk: under 5.
      expect(a.peopleWithDrop).toBeNull();
      expect(a.peopleAtRisk).toBeNull();
      const open = await indicatorAlerts(db, direction, {
        cycleId: c2.cycleId,
        config: { minGroupSize: 3 },
      });
      expect(open.alerts).toEqual([]);
      expect(open.peopleWithDrop).toBe(3);
      expect(open.peopleAtRisk).toBe(3);
      expect(open.minGroupSize).toBe(3);
    });
  });
});

describe("indicatorConfig and the settings", () => {
  it("reads the settings (defaults: a fall of 2, a risk at 2, groups of 5) and takes overrides", async () => {
    const defaults = { dropThreshold: 2, riskThreshold: 2, minGroupSize: 5 };
    expect(await indicatorConfig(db)).toEqual(defaults);
    await setSetting(db, hr, "alerts.dropThreshold", 3);
    await setSetting(db, hr, "alerts.riskThreshold", 1);
    await setSetting(db, hr, "aggregation.minGroupSize", 7);
    expect(await indicatorConfig(db)).toEqual({
      dropThreshold: 3,
      riskThreshold: 1,
      minGroupSize: 7,
    });
    expect(await indicatorConfig(db, { dropThreshold: 4 })).toEqual({
      dropThreshold: 4,
      riskThreshold: 1,
      minGroupSize: 7,
    });
  });

  it("changing the drop and risk thresholds changes the alerts", async () => {
    const names2 = async () =>
      (await indicatorAlerts(db, hr, { cycleId: c2.cycleId })).alerts.map(
        (a) => `${a.kind}:${a.person.name}`,
      );
    expect(await names2()).toEqual([
      `risk:${names.bruno}`,
      `risk:${names.fabio}`,
      `risk:${names.gina}`,
      `drop:${names.ana}`,
      `drop:${names.elena}`,
      `drop:${names.fabio}`,
      `drop:${names.fabio}`,
    ]);
    await setSetting(db, hr, "alerts.dropThreshold", 3);
    await setSetting(db, hr, "alerts.riskThreshold", 1);
    expect(await names2()).toEqual([
      `risk:${names.fabio}`,
      `drop:${names.elena}`,
      `drop:${names.fabio}`,
    ]);
    await setSetting(db, hr, "alerts.dropThreshold", 1);
    await setSetting(db, hr, "alerts.riskThreshold", 3);
    const loose = await indicatorAlerts(db, hr, { cycleId: c2.cycleId });
    expect(loose.peopleAtRisk).toBe(4);
    expect(loose.peopleWithDrop).toBe(4);
    // The matrix follows the risk threshold too.
    const m = await riskMatrix(db, hr, { cycleId: c2.cycleId });
    expect(m.riskThreshold).toBe(3);
    expect(m.riskCount).toBe(4);
  });

  it("changing the minimum group size changes what direction sees", async () => {
    const input = {
      cycleId: c2.cycleId,
      indicator: "retention" as const,
      groupBy: "department" as const,
    };
    expect(
      (await indicatorDistribution(db, direction, input)).series.map(
        (s) => s.key,
      ),
    ).toEqual(["Ingeniería"]);
    await setSetting(db, hr, "aggregation.minGroupSize", 3);
    const d = await indicatorDistribution(db, direction, input);
    expect(d.series.map((s) => s.key)).toEqual(["Ingeniería", "Producto"]);
    expect(d.minGroupSize).toBe(3);
    expect(d.suppressed).toBe(0);
    expect(d.total).toMatchObject({ n: 9 });
  });
});

describe("pickers", () => {
  it("lists the launched cycles, latest period first", async () => {
    await insertIndicatorCycle({
      name: "Borrador",
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
      status: "draft",
    });
    expect((await indicatorCycles(db)).map((c) => c.name)).toEqual([
      "H2 2024",
      "H1 2024",
    ]);
  });

  it("offers the areas and managers of the actor's reach in a cycle", async () => {
    expect(
      await indicatorFilterOptions(db, hr, { cycleId: c2.cycleId }),
    ).toEqual({
      departments: ["Ingeniería", "Producto"],
      managers: [
        { id: id.marta, name: names.marta },
        { id: id.nora, name: names.nora },
      ],
    });
    expect(
      await indicatorFilterOptions(db, marta(), { cycleId: c2.cycleId }),
    ).toEqual({
      departments: ["Ingeniería"],
      managers: [{ id: id.marta, name: names.marta }],
    });
    await forbidden(
      indicatorFilterOptions(db, as(id.ana, "employee"), {
        cycleId: c2.cycleId,
      }),
    );
  });

  it("offers the people only to those who may read them one by one", async () => {
    const all = await indicatorSubjects(db, hr);
    expect(all.people.map((p) => p.name)).toEqual(
      Object.values(names)
        .filter((n) => n !== names.marta && n !== names.nora)
        .sort((a, b) => a.localeCompare(b, "es")),
    );
    expect(all.managers.map((m) => m.name)).toEqual([names.marta, names.nora]);
    const mine = await indicatorSubjects(db, marta());
    expect(mine.people.map((p) => p.name)).toEqual([
      names.ana,
      names.bruno,
      names.carla,
      names.dario,
      names.elena,
      names.fabio,
    ]);
    const lead = await indicatorSubjects(db, direction);
    expect(lead.people).toEqual([]);
    expect(lead.departments).toEqual(["Ingeniería", "Producto"]);
    await forbidden(indicatorSubjects(db, as(id.ana, "employee")));
  });
});

describe("what the cycles and revisions leave out or order", () => {
  it("deleted cycles are out of every read", async () => {
    await db.execute(
      sql`update review_cycle set deleted_at = now() where id = ${c1.cycleId}::uuid`,
    );
    await expect(
      indicatorDistribution(db, hr, {
        cycleId: c1.cycleId,
        indicator: "retention",
        groupBy: "none",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      indicatorFilterOptions(db, hr, { cycleId: c1.cycleId }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      riskMatrix(db, hr, { cycleId: c1.cycleId }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await indicatorCycles(db)).map((c) => c.name)).toEqual(["H2 2024"]);
    const trend = await indicatorTrend(db, hr, { indicator: "retention" });
    expect(trend.points.map((p) => p.cycleName)).toEqual(["H2 2024"]);
    // Nothing before H2 2024 any more: no drops, only the risks.
    const alerts = await indicatorAlerts(db, hr, { cycleId: c2.cycleId });
    expect(alerts.alerts.map((a) => a.kind)).toEqual(["risk", "risk", "risk"]);
    expect((await indicatorSubjects(db, hr)).people.map((p) => p.name)).toEqual(
      [
        names.ana,
        names.bruno,
        names.carla,
        names.dario,
        names.elena,
        names.fabio,
        names.gina,
        names.hugo,
        names.iris,
      ],
    );
  });

  it("two revisions of a role in a cycle: one value per person, always the same", async () => {
    // A second retention revision (sort 5), as a template group leaves it.
    const extra = await insertIndicatorQuestion(c2.cycleId, "retention", 5);
    // Dario Mena answered both in his review: the first revision (3) counts.
    const [request] = await db.execute<{ id: string }>(
      sql`select id from review_request
          where participant_id = ${participant(c2, "dario")}::uuid
            and relationship = 'manager'`,
    );
    await db.execute(
      sql`insert into answer (request_id, question_revision_id, option_value, normalized)
          values (${request.id}::uuid, ${extra}::uuid, 1, 0)`,
    );
    // Jana Moya answered only the second: she counts, once.
    const jana = await insertPerson({
      displayName: "Jana Moya",
      noEmployment: true,
    });
    const p = await insertParticipant({
      cycleId: c2.cycleId,
      personId: jana,
      snapManagerPersonId: id.marta,
      snapDepartment: "Ingeniería",
    });
    await insertIndicatorReview({
      cycle: { ...c2, questions: { ...c2.questions, retention: extra } },
      participantId: p,
      reviewerPersonId: id.marta,
      retention: 5,
      engagement: 3,
    });
    const read = () =>
      indicatorDistribution(db, hr, {
        cycleId: c2.cycleId,
        indicator: "retention",
        groupBy: "none",
      });
    for (let i = 0; i < 3; i++) {
      expect((await read()).total).toMatchObject({
        counts: [1, 3, 1, 2, 3],
        n: 10,
      });
    }
  });

  it("the previous cycle is the one before in a total order: a cycle of the same period counts, by creation", async () => {
    // A re-import of the same semester, created after H2 2024.
    const again = await insertIndicatorCycle({
      name: "H2 2024 (nueva)",
      periodStart: "2024-07-01",
      periodEnd: "2024-12-31",
    });
    const p = await insertParticipant({
      cycleId: again.cycleId,
      personId: id.elena,
      snapManagerPersonId: id.marta,
      snapDepartment: "Ingeniería",
    });
    await insertIndicatorReview({
      cycle: again,
      participantId: p,
      reviewerPersonId: id.marta,
      retention: 1,
      engagement: 5,
    });
    const alerts = await indicatorAlerts(db, hr, { cycleId: again.cycleId });
    expect(alerts.alerts).toHaveLength(1);
    expect(alerts.alerts[0]).toMatchObject({
      kind: "drop",
      indicator: "retention",
      previousCycleName: "H2 2024",
      previousValue: 4,
      value: 1,
      delta: 3,
    });
    // The earlier one does not see the later as its previous.
    const before = await indicatorAlerts(db, hr, { cycleId: c2.cycleId });
    expect(
      before.alerts.filter((a) => a.person.name === names.elena),
    ).toHaveLength(1);
    const trend = await indicatorTrend(db, hr, {
      indicator: "retention",
      personId: id.elena,
    });
    expect(trend.points.map((p) => [p.cycleName, p.mean])).toEqual([
      ["H1 2024", 4],
      ["H2 2024", 4],
      ["H2 2024 (nueva)", 1],
    ]);
  });

  it("the filter options and the matrix follow the hierarchy asked for", async () => {
    await db.execute(
      sql`update employee_job_history set department = 'Soporte'
          where person_id = ${id.dario}::uuid and valid_to is null`,
    );
    expect(
      (await indicatorFilterOptions(db, hr, { cycleId: c2.cycleId }))
        .departments,
    ).toEqual(["Ingeniería", "Producto"]);
    expect(
      (
        await indicatorFilterOptions(db, hr, {
          cycleId: c2.cycleId,
          hierarchy: "current",
        })
      ).departments,
    ).toEqual(["Ingeniería", "Producto", "Soporte"]);
    // Ana Prieto (2, 4) works in Producto today: with Gina and Hugo.
    const asOf = await riskMatrix(db, hr, {
      cycleId: c2.cycleId,
      filters: { department: "Producto" },
    });
    const current = await riskMatrix(db, hr, {
      cycleId: c2.cycleId,
      filters: { department: "Producto" },
      hierarchy: "current",
    });
    expect([asOf.total, current.total]).toEqual([2, 3]);
    const alerts = await indicatorAlerts(db, hr, {
      cycleId: c2.cycleId,
      filters: { department: "Producto" },
      hierarchy: "current",
    });
    expect(
      alerts.alerts.map(
        (a) => `${a.kind}:${a.person.name}:${a.person.department}`,
      ),
    ).toEqual([`risk:${names.gina}:Producto`, `drop:${names.ana}:Producto`]);
  });

  it("a manager never reads a person who is themself, nor who was their report only in a draft cycle", async () => {
    const own = await insertParticipant({
      cycleId: c2.cycleId,
      personId: id.nora,
      snapManagerPersonId: id.nora,
      snapDepartment: "Producto",
    });
    await insertIndicatorReview({
      cycle: c2,
      participantId: own,
      reviewerPersonId: id.nora,
      retention: 2,
      engagement: 2,
    });
    await forbidden(
      indicatorTrend(db, nora(), { indicator: "retention", personId: id.nora }),
    );
    // Jana Moya reported to Marta only in a draft cycle.
    const draft = await insertIndicatorCycle({
      name: "Borrador",
      periodStart: "2025-01-01",
      periodEnd: "2025-06-30",
      status: "draft",
    });
    const jana = await insertPerson({
      displayName: "Jana Moya",
      noEmployment: true,
    });
    const p = await insertParticipant({
      cycleId: draft.cycleId,
      personId: jana,
      snapManagerPersonId: id.marta,
    });
    await insertIndicatorReview({
      cycle: draft,
      participantId: p,
      reviewerPersonId: id.marta,
      retention: 1,
      engagement: 1,
    });
    await forbidden(
      indicatorTrend(db, marta(), { indicator: "retention", personId: jana }),
    );
    // People may ask: nothing to draw, but nothing wrong either.
    expect(
      (await indicatorTrend(db, hr, { indicator: "retention", personId: jana }))
        .points,
    ).toEqual([]);
  });
});

describe("the page reads", () => {
  it.each([
    ["hr", () => hr],
    ["a manager", () => marta()],
    ["direction", () => direction],
  ])(
    "indicatorOverview gives what the separate reads give (%s)",
    async (_, who) => {
      const actor = who();
      const input = {
        cycleId: c2.cycleId,
        indicator: "retention" as const,
        groupBy: "department" as const,
      };
      const overview = await indicatorOverview(db, actor, {
        ...input,
        filters: {},
      });
      expect(overview.distribution).toEqual(
        await indicatorDistribution(db, actor, input),
      );
      expect(overview.matrix).toEqual(
        await riskMatrix(db, actor, { cycleId: c2.cycleId }),
      );
      expect(overview.alerts).toEqual(
        await indicatorAlerts(db, actor, { cycleId: c2.cycleId }),
      );
      expect(overview.options).toEqual(
        await indicatorFilterOptions(db, actor, { cycleId: c2.cycleId }),
      );
      // Filtered: the options stay those of the whole cycle.
      const filtered = await indicatorOverview(db, actor, {
        ...input,
        filters: { department: "Producto" },
      });
      expect(filtered.options).toEqual(overview.options);
      expect(filtered.matrix).toEqual(
        await riskMatrix(db, actor, {
          cycleId: c2.cycleId,
          filters: { department: "Producto" },
        }),
      );
    },
  );

  it("indicatorTrendOverview: both indicators and the picker values in one read", async () => {
    const overview = await indicatorTrendOverview(db, hr, {
      personId: id.ana,
    });
    expect(overview.trends.map((t) => t.indicator)).toEqual([
      "retention",
      "engagement",
    ]);
    expect(overview.trends[0]).toEqual(
      await indicatorTrend(db, hr, {
        indicator: "retention",
        personId: id.ana,
      }),
    );
    expect(overview.subjects).toEqual(await indicatorSubjects(db, hr));
    await forbidden(indicatorTrendOverview(db, as(id.ana, "employee"), {}));
    await forbidden(indicatorTrendOverview(db, marta(), { personId: id.gina }));
  });
});
