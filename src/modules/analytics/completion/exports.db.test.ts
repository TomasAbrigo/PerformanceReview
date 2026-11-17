import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { download, table } from "@/modules/exports/csv-test-support";
import { buildCompletionScenario, resetCompletionData } from "./test-support";

let c0: string;
let c1: string;
let marta: string;
let nico: string;

beforeAll(async () => {
  ({ c0, c1, marta, nico } = await buildCompletionScenario());
});

afterAll(async () => {
  await resetCompletionData();
  await closeDb();
});

describe("insights-completion.csv", () => {
  it("one row per group with counts, percentages and the delta vs the previous cycle", async () => {
    const { header, rows } = await table(
      "insights-completion.csv",
      `?cycle=${c1}&groupBy=department&locale=en`,
    );
    expect(header).toEqual([
      "cycle_name",
      "previous_cycle",
      "group_id",
      "group",
      "participants",
      "self_submitted",
      "self_applicable",
      "self_pct",
      "manager_submitted",
      "manager_applicable",
      "manager_pct",
      "self_delta_pp",
      "manager_delta_pp",
    ]);
    expect(rows.map((r) => r.group)).toEqual(["Tecnología", "Ventas", ""]);
    expect(rows[0]).toMatchObject({
      cycle_name: "2025-H1",
      previous_cycle: "2024-H2",
      group_id: "Tecnología",
      participants: "3",
      self_submitted: "2",
      self_applicable: "3",
      self_pct: "66.7",
      manager_submitted: "1",
      manager_applicable: "3",
      manager_pct: "33.3",
      self_delta_pp: "-33.3",
      manager_delta_pp: "-33.3",
    });
    // Ventas: the manager side applies to one person and none before.
    expect(rows[1]).toMatchObject({
      self_pct: "100",
      manager_pct: "0",
      self_delta_pp: "100",
      manager_delta_pp: "",
    });
  });

  it("one row for the whole cycle without grouping, and by manager", async () => {
    const all = await table(
      "insights-completion.csv",
      `?cycle=${c1}&groupBy=none&locale=en`,
    );
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({
      group: "",
      participants: "7",
      self_pct: "66.7",
      manager_pct: "40",
    });
    const byManager = await table(
      "insights-completion.csv",
      `?cycle=${c1}&groupBy=manager&locale=en`,
    );
    expect(byManager.rows.map((r) => [r.group_id, r.group])).toEqual([
      [marta, "Marta Gómez"],
      [nico, "Nico Ruiz"],
    ]);
  });

  it("the headers come in the language of the request", async () => {
    const { header } = await table(
      "insights-completion.csv",
      `?cycle=${c1}&groupBy=none`,
    );
    expect(header).toEqual([
      "ciclo",
      "ciclo anterior",
      "group_id",
      "grupo",
      "participantes",
      "autoevaluaciones enviadas",
      "autoevaluaciones que aplican",
      "autoevaluación (%)",
      "evaluaciones del manager enviadas",
      "evaluaciones del manager que aplican",
      "evaluación del manager (%)",
      "autoevaluación vs ciclo anterior (pp)",
      "evaluación del manager vs ciclo anterior (pp)",
    ]);
  });

  it("the first cycle has no previous one: empty delta cells", async () => {
    const { rows } = await table(
      "insights-completion.csv",
      `?cycle=${c0}&groupBy=none&locale=en`,
    );
    expect(rows[0]).toMatchObject({
      previous_cycle: "",
      self_delta_pp: "",
      manager_delta_pp: "",
    });
  });

  it("needs a cycle that exists", async () => {
    expect((await download("insights-completion.csv", "")).status).toBe(400);
    expect(
      (
        await download(
          "insights-completion.csv",
          "?cycle=00000000-0000-4000-8000-000000000000",
        )
      ).status,
    ).toBe(404);
  });
});

describe("insights-missing.csv", () => {
  it("lists who is missing, with no email column by default", async () => {
    const { header, rows } = await table(
      "insights-missing.csv",
      `?cycle=${c1}&locale=en`,
    );
    expect(header).toEqual([
      "cycle_name",
      "person_id",
      "name",
      "department",
      "manager_id",
      "manager",
      "self_status",
      "manager_status",
      "follow_up_notes",
    ]);
    expect(rows.map((r) => r.name)).toEqual([
      "Beto Benítez",
      "Gaby Giménez",
      "Carla Cabrera",
      "Emi Estévez",
    ]);
    expect(rows[0]).toMatchObject({
      cycle_name: "2025-H1",
      department: "Tecnología",
      manager: "Marta Gómez",
      self_status: "submitted",
      manager_status: "in_progress",
      follow_up_notes: "false",
    });
    expect(rows[2].follow_up_notes).toBe("true");
  });

  it("filters like the view and takes the email only with include_email=1", async () => {
    const plain = await table(
      "insights-missing.csv",
      `?cycle=${c1}&status=self_missing&manager=${nico}&locale=en`,
    );
    expect(plain.rows.map((r) => r.name)).toEqual(["Carla Cabrera"]);
    expect(plain.header).not.toContain("email");

    const withEmail = await table(
      "insights-missing.csv",
      `?cycle=${c1}&department=Tecnolog%C3%ADa&include_email=1&locale=en`,
    );
    expect(withEmail.header).toEqual([
      "cycle_name",
      "person_id",
      "name",
      "email",
      "department",
      "manager_id",
      "manager",
      "self_status",
      "manager_status",
      "follow_up_notes",
    ]);
    expect(withEmail.rows.map((r) => [r.name, r.email])).toEqual([
      ["Beto Benítez", "p3@example.test"],
      ["Carla Cabrera", "p4@example.test"],
    ]);
  });

  it("rejects what is not a valid status, and a cycle that does not exist", async () => {
    expect(
      (await download("insights-missing.csv", `?cycle=${c1}&status=late`))
        .status,
    ).toBe(400);
    expect(
      (
        await download(
          "insights-missing.csv",
          "?cycle=00000000-0000-4000-8000-000000000000",
        )
      ).status,
    ).toBe(404);
  });
});
