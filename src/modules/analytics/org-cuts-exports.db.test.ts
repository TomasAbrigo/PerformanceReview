import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { download, table } from "@/modules/exports/csv-test-support";
import {
  reset,
  type Scenario,
} from "@/modules/analytics/indicators/test-support";
import { buildReportScenario } from "@/modules/insights/test-support";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";

let s: Scenario;
let cycle: string;

beforeAll(async () => {
  s = await buildReportScenario();
  cycle = s.c2.cycleId;
  for (const who of ["ana", "bruno", "carla", "dario"] as const) {
    await setOrgAttributes(s.id[who], {
      account: "Cuenta A",
      project: "Proyecto A1",
      dm: "Diego",
      santex_lead: "Lía",
    });
  }
  for (const who of ["elena", "fabio", "gina", "hugo"] as const) {
    await setOrgAttributes(s.id[who], {
      account: "Cuenta B",
      dm: "Dora",
      santex_lead: "Lía",
    });
  }
}, 60_000);
afterAll(async () => {
  await reset();
  await closeDb();
});

describe("the CSV exports take the org cuts", () => {
  it("insights-completion: groups by account and DM, filters by Santex Lead", async () => {
    const byAccount = await table(
      "insights-completion.csv",
      `?cycle=${cycle}&groupBy=account&locale=en`,
    );
    expect(byAccount.rows.map((r) => [r.group, r.participants])).toEqual([
      ["Whole cycle", "9"],
      ["Cuenta A", "4"],
      ["Cuenta B", "4"],
      ["Unassigned", "1"],
    ]);
    const byDm = await table(
      "insights-completion.csv",
      `?cycle=${cycle}&groupBy=dm&locale=en`,
    );
    expect(byDm.rows.map((r) => r.group)).toEqual([
      "Whole cycle",
      "Diego",
      "Dora",
      "Unassigned",
    ]);
    const filtered = await table(
      "insights-completion.csv",
      `?cycle=${cycle}&groupBy=none&santexLead=L%C3%ADa&locale=en`,
    );
    expect(filtered.rows[0].participants).toBe("8");
  });

  it("insights-missing: filters by account", async () => {
    // Dario (Cuenta A) has a draft self review; Cuenta B has nothing missing.
    const a = await table(
      "insights-missing.csv",
      `?cycle=${cycle}&account=Cuenta%20A&locale=en`,
    );
    const b = await table(
      "insights-missing.csv",
      `?cycle=${cycle}&account=Cuenta%20B&locale=en`,
    );

    expect(a.rows.map((r) => r.name)).toEqual(["Dario Mena"]);
    expect(b.rows).toEqual([]);
  });

  it("insights-indicator-distribution: groups and filters", async () => {
    const byProject = await table(
      "insights-indicator-distribution.csv",
      `?cycle=${cycle}&indicator=retention&groupBy=project&locale=en`,
    );
    expect(new Set(byProject.rows.map((r) => r.group))).toEqual(
      new Set(["Proyecto A1", ""]),
    );
    const filtered = await table(
      "insights-indicator-distribution.csv",
      `?cycle=${cycle}&indicator=retention&groupBy=none&dm=Dora&locale=en`,
    );
    expect(filtered.header).toContain("people");
    expect(filtered.rows[0]).toMatchObject({ people: "4" });
  });

  it("insights-alerts: filters by DM", async () => {
    const { rows } = await table(
      "insights-alerts.csv",
      `?cycle=${cycle}&dm=Diego&locale=en`,
    );

    expect(
      rows.every((r) =>
        ["Ana Prieto", "Bruno Soler", "Carla Vega", "Dario Mena"].includes(
          r.name,
        ),
      ),
    ).toBe(true);
  });

  it("insights-goal-kpis and outliers take the cuts", async () => {
    const kpis = await table(
      "insights-goal-kpis.csv",
      `?cycle=${cycle}&groupBy=dm&locale=en`,
    );
    expect(kpis.rows.map((r) => [r.group, r.people])).toEqual([
      ["Diego", "4"],
      ["Dora", "4"],
      ["", "1"],
    ]);
    const filtered = await table(
      "insights-goal-kpis.csv",
      `?cycle=${cycle}&groupBy=account&project=Proyecto%20A1&locale=en`,
    );
    expect(filtered.rows.map((r) => [r.group, r.people])).toEqual([
      ["Cuenta A", "4"],
    ]);
    await expect(
      download(
        "insights-goal-outliers.csv",
        `?cycle=${cycle}&account=Cuenta%20A&locale=en`,
      ),
    ).resolves.toBeDefined();
  });

  it("insights-sentiment filters by account; insights-sentiment-by groups the comments", async () => {
    const total = (rows: Record<string, string>[]) =>
      rows.reduce((n, r) => n + Number(r.total), 0);
    const all = await table(
      "insights-sentiment.csv",
      `?cycle=${cycle}&locale=en`,
    );
    const a = await table(
      "insights-sentiment.csv",
      `?cycle=${cycle}&account=Cuenta%20A&locale=en`,
    );
    const b = await table(
      "insights-sentiment.csv",
      `?cycle=${cycle}&account=Cuenta%20B&locale=en`,
    );
    expect(total(all.rows)).toBe(5);
    expect(total(a.rows)).toBe(5);
    expect(total(b.rows)).toBe(0);

    const groups = await table(
      "insights-sentiment-by.csv",
      `?cycle=${cycle}&groupBy=dm&locale=en`,
    );
    expect(groups.header).toEqual([
      "group",
      "people",
      "positive",
      "constructive",
      "neutral",
      "mixed",
      "negative",
      "total",
    ]);
    expect(groups.rows.map((r) => [r.group, r.people, r.total])).toEqual([
      ["Diego", "3", "5"],
    ]);
  });
});
