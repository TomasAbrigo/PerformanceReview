import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import {
  buildScenario,
  reset,
} from "@/modules/analytics/indicators/test-support";
import { download, table } from "@/modules/exports/csv-test-support";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";

let ana: string;
let nora: string;

beforeAll(async () => {
  const s = await buildScenario();
  ana = s.id.ana;
  nora = s.id.nora;
  await setOrgAttributes(ana, { account: "Cuenta A" });
});
afterAll(async () => {
  await reset();
  await closeDb();
});

describe("insights-period-detail.csv", () => {
  it("a row per cycle, oldest first, with the head count, completion, means and goals", async () => {
    const { header, rows } = await table(
      "insights-period-detail.csv",
      "?locale=en",
    );

    expect(header).toEqual([
      "cycle_name",
      "period start",
      "period end",
      "participants",
      "self_pct",
      "manager_pct",
      "valued by the company (mean 1-4)",
      "valued by the company (people)",
      "retention (mean 1-5)",
      "retention (people)",
      "Bamboo engagement (mean 1-5)",
      "Bamboo engagement (people)",
      "goals",
      "goals completed (%)",
    ]);
    expect(rows.map((r) => r.cycle_name)).toEqual(["H1 2024", "H2 2024"]);
    expect(rows[0]).toMatchObject({
      "period start": "2024-01-01",
      "period end": "2024-06-30",
      participants: "6",
      manager_pct: "100",
      "retention (mean 1-5)": "3.5",
      "retention (people)": "6",
      "Bamboo engagement (mean 1-5)": "3.67",
      "valued by the company (mean 1-4)": "",
      goals: "0",
      "goals completed (%)": "",
    });
    expect(rows[1]).toMatchObject({
      participants: "9",
      "retention (mean 1-5)": "3.11",
      "retention (people)": "9",
    });
  });

  it("takes the same cuts as the page (area, manager, org attributes) and answers in Spanish", async () => {
    const byAccount = await table(
      "insights-period-detail.csv",
      "?account=Cuenta%20A",
    );
    expect(byAccount.rows.map((r) => r.participantes)).toEqual(["1", "1"]);
    expect(byAccount.header[0]).toBe("ciclo");
    const byManager = await table(
      "insights-period-detail.csv",
      `?manager=${nora}`,
    );
    expect(byManager.rows.map((r) => r.participantes)).toEqual(["1", "3"]);
  });

  it("is a 400 for a manager that is not an id", async () => {
    expect(
      (await download("insights-period-detail.csv", "?manager=nope")).status,
    ).toBe(400);
  });
});
