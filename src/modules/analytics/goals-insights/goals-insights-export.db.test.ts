import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { exportCsv } from "@/modules/exports/entities";
import { buildScenario, names, reset, type Scenario } from "./test-support";

let s: Scenario;

beforeAll(async () => {
  s = await buildScenario();
});
afterAll(async () => {
  await reset();
  await closeDb();
});

const csv = async (file: string, query: string) => {
  const res = await exportCsv(
    db,
    file,
    new Request(`http://x/api/v1/export/${file}?${query}`),
  );
  return {
    lines: (await res.text()).replace(/^﻿/, "").trim().split(/\r?\n/),
    disposition: res.headers.get("content-disposition"),
  };
};

describe("goals insights CSV exports", () => {
  it("insights-goal-kpis.csv: a row per group with counts, shares and mean progress", async () => {
    const { lines, disposition } = await csv(
      "insights-goal-kpis.csv",
      `cycle=${s.h1.cycleId}&groupBy=department`,
    );
    expect(disposition).toContain(
      `insights-goal-kpis-${s.h1.cycleId}-department.csv`,
    );
    // Ingeniería: 26 goals, 14 completed (53.8 %), 11 in progress (42.3 %),
    // 1 closed, 2 overdue (7.7 %), mean progress 1920 / 26 = 73.8.
    // Producto: 7 goals, 3 completed (42.9 %), 4 in progress (57.1 %),
    // 2 overdue (28.6 %), mean progress 370 / 7 = 52.9.
    expect(lines).toEqual([
      "group_id,grupo,personas,goals,completados,en curso,cerrados,vencidos,% completados,% en curso,% vencidos,avance promedio",
      "Ingeniería,Ingeniería,6,26,14,11,1,2,53.8,42.3,7.7,73.8",
      "Producto,Producto,3,7,3,4,0,2,42.9,57.1,28.6,52.9",
    ]);
  });

  it("the KPI export groups by person or manager, in the asked language, with the filters", async () => {
    const person = await csv(
      "insights-goal-kpis.csv",
      `cycle=${s.h1.cycleId}&groupBy=person&department=Producto&locale=en`,
    );
    expect(person.lines[0]).toBe(
      "group_id,group,people,goals,completed,in_progress,closed,overdue,completed_pct,in_progress_pct,overdue_pct,avg_progress",
    );
    expect(person.lines.slice(1)).toEqual([
      `${s.id.gina},${names.gina},1,4,1,3,0,2,25,75,50,32.5`,
      `${s.id.hugo},${names.hugo},1,1,1,0,0,0,100,0,0,100`,
      `${s.id.iris},${names.iris},1,2,1,1,0,0,50,50,0,70`,
    ]);
    const manager = await csv(
      "insights-goal-kpis.csv",
      `cycle=${s.h1.cycleId}&groupBy=manager&hierarchy=current`,
    );
    // Ana moved to Nora: 5 in Ingeniería's manager, 4 in Nora's.
    expect(manager.lines.slice(1).map((l) => l.split(",").slice(1, 4))).toEqual(
      [
        [names.marta, "5", "21"],
        [names.nora, "4", "12"],
      ],
    );
  });

  it("insights-goal-outliers.csv: a row per outlier, no emails", async () => {
    const { lines } = await csv(
      "insights-goal-outliers.csv",
      `cycle=${s.h1.cycleId}`,
    );
    expect(lines).toEqual([
      "tipo,person_id,nombre,manager_id,manager,área,goals,completados,% completados,retención,compromiso",
      `done_but_low,${s.id.fabio},${names.fabio},${s.id.marta},${names.marta},Ingeniería,5,4,80,3,1`,
      `done_but_low,${s.id.ana},${names.ana},${s.id.marta},${names.marta},Ingeniería,5,4,80,2,4`,
      `behind_but_high,${s.id.gina},${names.gina},${s.id.nora},${names.nora},Producto,4,1,25,5,4`,
      `behind_but_high,${s.id.elena},${names.elena},${s.id.marta},${names.marta},Ingeniería,10,3,30,4,5`,
    ]);
    expect(lines.join("\n")).not.toMatch(/@/);
    const mine = await csv(
      "insights-goal-outliers.csv",
      `cycle=${s.h1.cycleId}&manager=${s.id.nora}`,
    );
    expect(mine.lines).toHaveLength(2);
  });

  it("asks for a cycle", async () => {
    await expect(
      exportCsv(
        db,
        "insights-goal-kpis.csv",
        new Request("http://x/api/v1/export/insights-goal-kpis.csv"),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
