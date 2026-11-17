import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { setSetting } from "@/modules/settings";
import {
  goalInsights,
  goalInsightsFilterOptions,
  goalKpis,
  goalOutliers,
  goalsVsIndicators,
} from ".";
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

describe("goalInsights (everything the page shows, from one load)", () => {
  it("gives what the separate queries give, filters included", async () => {
    const input = {
      cycleId: s.h1.cycleId,
      hierarchy: "current" as const,
      filters: { department: "Producto" },
    };
    const all = await goalInsights(db, hr, { ...input, groupBy: "person" });
    expect(all.kpis).toEqual(
      await goalKpis(db, hr, { ...input, groupBy: "person" }),
    );
    expect(all.vsIndicators).toEqual(await goalsVsIndicators(db, hr, input));
    expect(all.outliers).toEqual(await goalOutliers(db, hr, input));
    // The options come from the unfiltered participants: the other area is
    // still there to pick, while the views are narrowed to Producto.
    expect(all.options).toEqual(
      await goalInsightsFilterOptions(db, hr, {
        cycleId: s.h1.cycleId,
        hierarchy: "current",
      }),
    );
    expect(all.options.departments).toEqual(["Ingeniería", "Producto"]);
    expect(all.kpis.groups.map((g) => g.label)).toEqual([
      "Ana Prieto",
      "Gina Paz",
      "Hugo Sosa",
      "Iris Cano",
    ]);
  });

  it("applies the same reach to all of it: a manager, direction, nobody else", async () => {
    const marta = await goalInsights(db, as(s.id.marta, "manager"), {
      cycleId: s.h1.cycleId,
      groupBy: "person",
    });
    expect(marta.kpis.groups).toHaveLength(6);
    expect(marta.vsIndicators.rows).toHaveLength(6);
    expect(marta.options.managers.map((m) => m.name)).toEqual([
      "Marta Quiroga",
    ]);
    const dir = await goalInsights(db, direction, {
      cycleId: s.h1.cycleId,
      groupBy: "department",
    });
    expect(dir.vsIndicators.rows).toEqual([]);
    expect(dir.outliers.doneButLow.people).toEqual([]);
    expect(dir.options.managers).toEqual([]);
    await expect(
      goalInsights(db, direction, { cycleId: s.h1.cycleId, groupBy: "person" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      goalInsights(db, as(s.id.ana, "employee"), {
        cycleId: s.h1.cycleId,
        groupBy: "department",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reads the settings that matter: the risk threshold and the minimum", async () => {
    await setSetting(db, hr, "alerts.riskThreshold", 1);
    await setSetting(db, hr, "aggregation.minGroupSize", 3);
    const people = await goalInsights(db, hr, {
      cycleId: s.h1.cycleId,
      groupBy: "department",
    });
    expect(people.outliers.thresholds.riskThreshold).toBe(1);
    expect(people.outliers.doneButLow.people.map((p) => p.name)).toEqual([
      "Fabio Luna",
    ]);
    const dir = await goalInsights(db, direction, {
      cycleId: s.h1.cycleId,
      groupBy: "department",
    });
    expect(dir.kpis.minGroupSize).toBe(3);
    expect(dir.vsIndicators.minGroupSize).toBe(3);
    expect(dir.outliers.minGroupSize).toBe(3);
  });

  it("is not_found for an unknown cycle", async () => {
    await expect(
      goalInsights(db, hr, {
        cycleId: "00000000-0000-4000-8000-000000000000",
        groupBy: "person",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
