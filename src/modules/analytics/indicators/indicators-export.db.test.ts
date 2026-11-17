import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { exportCsv } from "@/modules/exports/entities";
import { buildScenario, names, reset, type Scenario } from "./test-support";

let s: Scenario;

beforeEach(async () => {
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

describe("insights CSV exports", () => {
  it("insights-indicator-distribution.csv: a row per group and value, with n and mean", async () => {
    const { lines, disposition } = await csv(
      "insights-indicator-distribution.csv",
      `cycle=${s.c2.cycleId}&indicator=engagement&groupBy=none`,
    );
    expect(disposition).toContain(
      `insights-indicator-distribution-${s.c2.cycleId}-engagement.csv`,
    );
    // Eight people answered engagement in H2 2024: 1, 3, 1, 2 and 1 of each value.
    expect(lines).toEqual([
      "grupo,indicador,valor,cantidad,personas,promedio",
      ",engagement,1,1,8,2.875",
      ",engagement,2,3,8,2.875",
      ",engagement,3,1,8,2.875",
      ",engagement,4,2,8,2.875",
      ",engagement,5,1,8,2.875",
    ]);
  });

  it("the distribution export groups by area and filters, with headers in the asked language", async () => {
    const { lines } = await csv(
      "insights-indicator-distribution.csv",
      `cycle=${s.c2.cycleId}&indicator=retention&groupBy=department&locale=en`,
    );
    expect(lines[0]).toBe("group,indicator,value,count,people,mean");
    expect(lines.slice(1).map((l) => l.split(",").slice(0, 5))).toEqual([
      ...[1, 2, 1, 1, 1].map((count, i) => [
        "Ingeniería",
        "retention",
        `${i + 1}`,
        `${count}`,
        "6",
      ]),
      ...[0, 1, 0, 1, 1].map((count, i) => [
        "Producto",
        "retention",
        `${i + 1}`,
        `${count}`,
        "3",
      ]),
    ]);
    const filtered = await csv(
      "insights-indicator-distribution.csv",
      `cycle=${s.c2.cycleId}&groupBy=none&department=Producto`,
    );
    expect(filtered.lines[1]).toBe(",retention,1,0,3,3.6666666666666665");
  });

  it("insights-alerts.csv: a row per alert, with the person and the numbers", async () => {
    const { id, c2 } = s;
    const { lines } = await csv("insights-alerts.csv", `cycle=${c2.cycleId}`);
    expect(lines).toEqual([
      "alerta,indicador,person_id,nombre,manager_id,manager,área,ciclo anterior,valor anterior,valor,caída,retención,compromiso",
      `risk,,${id.bruno},${names.bruno},${id.marta},${names.marta},Ingeniería,,,,,2,2`,
      `risk,,${id.fabio},${names.fabio},${id.marta},${names.marta},Ingeniería,,,,,1,1`,
      `risk,,${id.gina},${names.gina},${id.nora},${names.nora},Producto,,,,,2,2`,
      `drop,retention,${id.ana},${names.ana},${id.marta},${names.marta},Ingeniería,H1 2024,4,2,2,,`,
      `drop,engagement,${id.elena},${names.elena},${id.marta},${names.marta},Ingeniería,H1 2024,5,2,3,,`,
      `drop,retention,${id.fabio},${names.fabio},${id.marta},${names.marta},Ingeniería,H1 2024,3,1,2,,`,
      `drop,engagement,${id.fabio},${names.fabio},${id.marta},${names.marta},Ingeniería,H1 2024,4,1,3,,`,
    ]);
    const mine = await csv(
      "insights-alerts.csv",
      `cycle=${c2.cycleId}&manager=${id.nora}`,
    );
    expect(mine.lines).toHaveLength(2);
    expect(mine.lines[1]).toContain(names.gina);
  });

  it("asks for a cycle", async () => {
    await expect(
      exportCsv(
        db,
        "insights-alerts.csv",
        new Request("http://x/api/v1/export/insights-alerts.csv"),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
