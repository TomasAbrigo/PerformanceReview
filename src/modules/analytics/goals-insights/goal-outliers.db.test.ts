import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { setSetting } from "@/modules/settings";
import { goalOutliers } from ".";
import {
  as,
  buildScenario,
  direction,
  hr,
  reset,
  type Scenario,
} from "./test-support";

let s: Scenario;

beforeAll(async () => {
  s = await buildScenario();
});
afterEach(async () => {
  await db.execute(sql`delete from app_setting`);
});
afterAll(async () => {
  await reset();
  await closeDb();
});

const names = (g: { people: { name: string }[] }) =>
  g.people.map((p) => p.name);

describe("goalOutliers (People)", () => {
  it("finds the people with goals done but low indicators, and goals behind but high ones", async () => {
    const out = await goalOutliers(db, hr, { cycleId: s.h1.cycleId });
    expect(out.thresholds).toEqual({
      goalsHigh: 80,
      goalsLow: 30,
      riskThreshold: 2,
      indicatorHigh: 4,
    });
    // Done (>= 80 %) with retention or engagement <= 2: Ana (80 %, retention
    // 2) and Fabio (80 %, engagement 1; the lowest indicator first). Carla
    // and Hugo are at 100 % but their indicators are fine.
    expect(names(out.doneButLow)).toEqual(["Fabio Luna", "Ana Prieto"]);
    expect(out.doneButLow.count).toBe(2);
    expect(out.doneButLow.people[0]).toMatchObject({
      goals: 5,
      completed: 4,
      completedPct: 80,
      retention: 3,
      engagement: 1,
      managerName: "Marta Quiroga",
      department: "Ingeniería",
    });
    // Behind (<= 30 %) with both indicators >= 4: Gina (25 %, 5/4) and Elena
    // (exactly 30 %, 4/5). Bruno is behind too, but his indicators are 3.
    expect(names(out.behindButHigh)).toEqual(["Gina Paz", "Elena Ríos"]);
    expect(out.behindButHigh.count).toBe(2);
  });

  it("people without goals, or without an answer, are never outliers", async () => {
    const out = await goalOutliers(db, hr, { cycleId: s.h1.cycleId });
    const all = [...names(out.doneButLow), ...names(out.behindButHigh)];
    // Dario has no goals; Iris (50 %) is in between and has no engagement.
    expect(all).not.toContain("Dario Mena");
    expect(all).not.toContain("Iris Cano");
  });

  it("the risk threshold is the alerts.riskThreshold setting", async () => {
    await setSetting(db, hr, "alerts.riskThreshold", 1);
    const out = await goalOutliers(db, hr, { cycleId: s.h1.cycleId });
    expect(out.thresholds.riskThreshold).toBe(1);
    expect(names(out.doneButLow)).toEqual(["Fabio Luna"]);
  });

  it("every threshold can be given for one call", async () => {
    const strict = await goalOutliers(db, hr, {
      cycleId: s.h1.cycleId,
      thresholds: { goalsHigh: 100, riskThreshold: 4 },
    });
    // At 100 %: Carla (5/5 no) and Hugo (4/4: both <= 4).
    expect(names(strict.doneButLow)).toEqual(["Hugo Sosa"]);
    const wide = await goalOutliers(db, hr, {
      cycleId: s.h1.cycleId,
      thresholds: { goalsLow: 50, indicatorHigh: 3 },
    });
    // <= 50 % with both >= 3: Bruno (25 %), Gina (25 %), Elena (30 %); Iris
    // (50 %) has no engagement.
    expect(names(wide.behindButHigh)).toEqual([
      "Bruno Soler",
      "Gina Paz",
      "Elena Ríos",
    ]);
    expect(wide.thresholds).toMatchObject({ goalsLow: 50, indicatorHigh: 3 });
  });

  it("filters by area and reads today's org", async () => {
    const out = await goalOutliers(db, hr, {
      cycleId: s.h1.cycleId,
      filters: { department: "Producto" },
    });
    expect(names(out.doneButLow)).toEqual([]);
    expect(names(out.behindButHigh)).toEqual(["Gina Paz"]);
    const current = await goalOutliers(db, hr, {
      cycleId: s.h1.cycleId,
      hierarchy: "current",
      filters: { department: "Producto" },
    });
    // Ana works in Producto today.
    expect(names(current.doneButLow)).toEqual(["Ana Prieto"]);
    expect(current.doneButLow.people[0].managerName).toBe("Nora Salas");
  });
});

describe("goalOutliers (who reads)", () => {
  it("a manager reads the outliers among their direct reports", async () => {
    const marta = await goalOutliers(db, as(s.id.marta, "manager"), {
      cycleId: s.h1.cycleId,
    });
    expect(names(marta.doneButLow)).toEqual(["Fabio Luna", "Ana Prieto"]);
    expect(names(marta.behindButHigh)).toEqual(["Elena Ríos"]);
    const nora = await goalOutliers(db, as(s.id.nora, "manager"), {
      cycleId: s.h1.cycleId,
    });
    expect(names(nora.doneButLow)).toEqual([]);
    expect(names(nora.behindButHigh)).toEqual(["Gina Paz"]);
  });

  it("an employee is forbidden, also reading about themself", async () => {
    for (const actor of [
      as(s.id.fabio, "employee"),
      { personId: null, role: "employee" as const },
    ]) {
      await expect(
        goalOutliers(db, actor, { cycleId: s.h1.cycleId }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("direction gets counts, over the minimum only, and never a person", async () => {
    const strict = await goalOutliers(db, direction, { cycleId: s.h1.cycleId });
    expect(strict.minGroupSize).toBe(5);
    expect(strict.doneButLow).toEqual({ count: null, people: [] });
    expect(strict.behindButHigh).toEqual({ count: null, people: [] });
    await setSetting(db, hr, "aggregation.minGroupSize", 2);
    const loose = await goalOutliers(db, direction, { cycleId: s.h1.cycleId });
    expect(loose.minGroupSize).toBe(2);
    expect(loose.doneButLow).toEqual({ count: 2, people: [] });
    expect(loose.behindButHigh).toEqual({ count: 2, people: [] });
  });
});
