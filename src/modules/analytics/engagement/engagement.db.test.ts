import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { insertEngagement } from "@/modules/engagement/test-support";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";
import { ReviewError } from "@/modules/review-core/review-errors";
import { setSetting } from "@/modules/settings/service";
import { insertJob, insertPerson, resetAll } from "../test-support";
import {
  engagementEvolution,
  engagementFilterOptions,
  engagementPeople,
  engagementTile,
} from "./queries";

const hr: ActorContext = { personId: null, role: "hr" };
const direction: ActorContext = { personId: null, role: "direction" };

let marta: string;
let nora: string;
let ana: string;
let bruno: string;
let carla: string;
let diego: string;

beforeEach(async () => {
  await resetAll();
  marta = await insertPerson({ displayName: "Marta Quiroga", bambooId: "1" });
  nora = await insertPerson({ displayName: "Nora Salas", bambooId: "2" });
  ana = await insertPerson({ displayName: "Ana Prieto", bambooId: "11" });
  bruno = await insertPerson({ displayName: "Bruno Soler", bambooId: "12" });
  carla = await insertPerson({ displayName: "Carla Rey", bambooId: "13" });
  diego = await insertPerson({ displayName: "Diego Paz", bambooId: "14" });
  for (const id of [ana, bruno, carla]) {
    await insertJob({
      personId: id,
      validFrom: "2020-01-01",
      managerPersonId: marta,
      department: "Ingeniería",
      location: "Córdoba",
    });
  }
  await insertJob({
    personId: diego,
    validFrom: "2020-01-01",
    managerPersonId: nora,
    department: "Datos",
    location: "Rosario",
  });
});
afterAll(async () => {
  await resetAll();
  await closeDb();
});

const JAN = "2026-01-01";
const FEB = "2026-02-01";
const MAR = "2026-03-01";

/** Jan: Ana .9 alto, Bruno .7 medio, Carla falta, Diego .3 bajo. Feb: Ana .5, Bruno .5 regular. */
async function seedData() {
  await insertEngagement({
    personId: ana,
    month: JAN,
    score: 0.9,
    segment: "alto",
  });
  await insertEngagement({
    personId: bruno,
    month: JAN,
    score: 0.7,
    segment: "medio",
  });
  await insertEngagement({ personId: carla, month: JAN, segment: "falta" });
  await insertEngagement({
    personId: diego,
    month: JAN,
    score: 0.3,
    segment: "bajo",
  });
  await insertEngagement({
    personId: ana,
    month: FEB,
    score: 0.5,
    segment: "regular",
  });
  await insertEngagement({
    personId: bruno,
    month: FEB,
    score: 0.5,
    segment: "regular",
  });
}

describe("engagementEvolution", () => {
  it("derives a segment the file did not give with the current cutoffs; the file's own is kept (#132)", async () => {
    await insertEngagement({
      personId: ana,
      month: JAN,
      score: 0.7,
      segment: "medio",
      fromFile: false,
    });
    await insertEngagement({
      personId: bruno,
      month: JAN,
      score: 0.7,
      segment: "alto",
      fromFile: true,
    });
    await setSetting(db, hr, "engagement.cutoffMedio", 75);
    const evo = await engagementEvolution(db, hr);
    expect(evo.months[0].segments).toMatchObject({
      alto: 1,
      medio: 0,
      regular: 1,
    });
    const people = await engagementPeople(db, hr, {
      month: JAN,
      segment: "regular",
    });
    expect(people.map((p) => p.personId)).toEqual([ana]);
    await setSetting(db, hr, "engagement.cutoffMedio", 60);
  });

  it("counts people, participation, mean score and segments per month for People", async () => {
    await seedData();

    const evolution = await engagementEvolution(db, hr);

    expect(evolution).toMatchObject({
      from: "2025-03-01",
      to: FEB,
      minGroupSize: null,
      hiddenMonths: 0,
    });
    const [jan, feb] = evolution.months;
    expect(jan).toMatchObject({
      month: JAN,
      hidden: false,
      people: 4,
      respondents: 3,
      participation: 0.75,
      segments: { alto: 1, medio: 1, regular: 0, bajo: 1, falta: 1 },
    });
    expect(jan.mean).toBeCloseTo((0.9 + 0.7 + 0.3) / 3);
    expect(feb).toMatchObject({
      month: FEB,
      people: 2,
      respondents: 2,
      participation: 1,
      segments: { regular: 2, falta: 0 },
    });
    expect(feb.mean).toBeCloseTo(0.5);
  });

  it("reads the range asked for, both months included, and only months with data", async () => {
    await seedData();
    await insertEngagement({
      personId: ana,
      month: MAR,
      score: 0.6,
      segment: "medio",
    });

    const jan = await engagementEvolution(db, hr, { from: JAN, to: JAN });
    expect(jan.months.map((m) => m.month)).toEqual([JAN]);
    const all = await engagementEvolution(db, hr, { from: JAN, to: MAR });
    expect(all.months.map((m) => m.month)).toEqual([JAN, FEB, MAR]);
    // A month written MM/YYYY or with a day is read as its first.
    const alt = await engagementEvolution(db, hr, {
      from: "02/2026",
      to: "2026-03-15",
    });
    expect(alt.months.map((m) => m.month)).toEqual([FEB, MAR]);
  });

  it("defaults to the 12 months ending at the last month with data", async () => {
    await insertEngagement({
      personId: ana,
      month: "2024-01-01",
      score: 0.4,
      segment: "regular",
    });
    await insertEngagement({
      personId: ana,
      month: "2025-05-01",
      score: 0.4,
      segment: "regular",
    });
    await insertEngagement({
      personId: ana,
      month: "2026-04-01",
      score: 0.4,
      segment: "regular",
    });

    const evolution = await engagementEvolution(db, hr);

    expect(evolution.from).toBe("2025-05-01");
    expect(evolution.to).toBe("2026-04-01");
    expect(evolution.months.map((m) => m.month)).toEqual([
      "2025-05-01",
      "2026-04-01",
    ]);
  });

  it("has nothing without data", async () => {
    expect(await engagementEvolution(db, hr)).toEqual({
      months: [],
      from: null,
      to: null,
      minGroupSize: null,
      hiddenMonths: 0,
    });
  });

  it("leaves out soft-deleted rows", async () => {
    await insertEngagement({
      personId: ana,
      month: JAN,
      score: 0.9,
      segment: "alto",
    });
    await insertEngagement({
      personId: bruno,
      month: JAN,
      score: 0.1,
      segment: "bajo",
      deleted: true,
    });

    const [jan] = (await engagementEvolution(db, hr)).months;
    expect(jan.people).toBe(1);
  });

  it("filters by area, location and manager, as of each month", async () => {
    await seedData();
    // In February Ana moves to Datos under Nora.
    await db.execute(
      (await import("drizzle-orm"))
        .sql`update employee_job_history set valid_to = '2026-02-10' where person_id = ${ana}`,
    );
    await insertJob({
      personId: ana,
      validFrom: "2026-02-10",
      managerPersonId: nora,
      department: "Datos",
      location: "Rosario",
    });

    const ing = await engagementEvolution(db, hr, { department: "Ingeniería" });
    expect(ing.months.map((m) => [m.month, m.people])).toEqual([
      [JAN, 3],
      [FEB, 1],
    ]);
    const datos = await engagementEvolution(db, hr, { department: "Datos" });
    expect(datos.months.map((m) => [m.month, m.people])).toEqual([
      [JAN, 1],
      [FEB, 1],
    ]);
    const byManager = await engagementEvolution(db, hr, { managerId: nora });
    expect(byManager.months.map((m) => m.people)).toEqual([1, 1]);
    const rosario = await engagementEvolution(db, hr, { location: "Rosario" });
    expect(rosario.months.map((m) => m.people)).toEqual([1, 1]);
  });

  it("filters by org attributes, as of the end of each month", async () => {
    await seedData();
    await setOrgAttributes(
      ana,
      { account: "Cuenta A", dm: "Marta Quiroga" },
      { validTo: "2026-02-09" },
    );
    await setOrgAttributes(
      ana,
      { account: "Cuenta B", dm: "Nora Salas" },
      { validFrom: "2026-02-10" },
    );
    await setOrgAttributes(bruno, { account: "Cuenta A", dm: "Marta Quiroga" });

    const a = await engagementEvolution(db, hr, { account: "Cuenta A" });
    expect(a.months.map((m) => [m.month, m.people])).toEqual([
      [JAN, 2],
      [FEB, 1],
    ]);
    const b = await engagementEvolution(db, hr, { account: "Cuenta B" });
    expect(b.months.map((m) => [m.month, m.people])).toEqual([[FEB, 1]]);
    const dm = await engagementEvolution(db, hr, { dm: "Nora Salas" });
    expect(dm.months.map((m) => [m.month, m.people])).toEqual([[FEB, 1]]);
  });

  it("a manager reads their direct reports of each month, never themself or others", async () => {
    await seedData();
    await insertEngagement({
      personId: marta,
      month: JAN,
      score: 0.1,
      segment: "bajo",
    });
    await insertJob({
      personId: marta,
      validFrom: "2020-01-01",
      managerPersonId: marta,
    });

    const evolution = await engagementEvolution(db, {
      personId: marta,
      role: "manager",
    });

    expect(evolution.months.map((m) => [m.month, m.people])).toEqual([
      [JAN, 3],
      [FEB, 2],
    ]);
    expect(evolution.minGroupSize).toBeNull();
    // Diego (Nora's) is out whatever they ask for.
    const asked = await engagementEvolution(
      db,
      { personId: marta, role: "manager" },
      { department: "Datos" },
    );
    expect(asked.months).toEqual([]);
  });

  it("direction reads aggregates: months under the minimum are hidden and a DM filter is ignored", async () => {
    await seedData();
    await setOrgAttributes(ana, { dm: "Marta Quiroga" });

    const masked = await engagementEvolution(db, direction, {
      minGroupSize: 3,
    });
    expect(masked.minGroupSize).toBe(3);
    expect(masked.hiddenMonths).toBe(1);
    const [jan, feb] = masked.months;
    // January: 4 people, 3 scores, but "falta" is a cell of 1 and the others are 1: under 3.
    expect(jan).toMatchObject({
      hidden: false,
      people: 4,
      segments: null,
      participation: null,
    });
    expect(jan.mean).toBeCloseTo((0.9 + 0.7 + 0.3) / 3);
    expect(feb).toEqual({
      month: FEB,
      hidden: true,
      people: null,
      respondents: null,
      participation: null,
      mean: null,
      segments: null,
    });
    // Filtering by the DM would single a team out: read without it.
    const byDm = await engagementEvolution(db, direction, {
      minGroupSize: 3,
      dm: "Marta Quiroga",
    });
    expect(byDm.months.map((m) => m.people)).toEqual(
      masked.months.map((m) => m.people),
    );
  });

  it("direction shows the segments when every non-empty cell reaches the minimum", async () => {
    for (let i = 0; i < 6; i++) {
      const p = await insertPerson({
        displayName: `Persona ${i}`,
        bambooId: `9${i}`,
      });
      await insertEngagement({
        personId: p,
        month: JAN,
        score: i < 3 ? 0.9 : 0.5,
        segment: i < 3 ? "alto" : "regular",
      });
    }

    const [jan] = (
      await engagementEvolution(db, direction, { minGroupSize: 3 })
    ).months;

    expect(jan).toMatchObject({
      hidden: false,
      people: 6,
      participation: 1,
      segments: { alto: 3, regular: 3, medio: 0, bajo: 0, falta: 0 },
    });
  });

  it("direction reads the minimum from the setting by default", async () => {
    await seedData();
    const evolution = await engagementEvolution(db, direction);
    // The default of 5 hides both months (4 and 2 people).
    expect(evolution.minGroupSize).toBe(5);
    expect(evolution.months.every((m) => m.hidden)).toBe(true);
  });

  it("forbids employees and a manager without a person", async () => {
    await seedData();
    for (const actor of [
      { personId: ana, role: "employee" },
      { personId: null, role: "manager" },
    ] as const) {
      await expect(engagementEvolution(db, actor)).rejects.toBeInstanceOf(
        ReviewError,
      );
    }
  });

  it("rejects a range or a manager that is not valid", async () => {
    await expect(
      engagementEvolution(db, hr, { from: "marzo" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      engagementEvolution(db, hr, { managerId: "no-uuid" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("engagementTile", () => {
  it("is the latest month next to the previous one", async () => {
    await seedData();

    const tile = await engagementTile(db, hr);

    expect(tile?.latest).toMatchObject({ month: FEB, people: 2 });
    expect(tile?.previous).toMatchObject({ month: JAN, people: 4 });
  });

  it("has no previous month when the one before has no data, and none without data", async () => {
    expect(await engagementTile(db, hr)).toBeNull();
    await insertEngagement({
      personId: ana,
      month: MAR,
      score: 0.6,
      segment: "medio",
    });
    expect((await engagementTile(db, hr))?.previous).toBeNull();
  });

  it("within a cycle's period: the latest month inside it, not the latest of all (#133)", async () => {
    await seedData();
    const tile = await engagementTile(db, hr, {
      within: { start: "2025-12-15", end: "2026-01-31" },
    });
    expect(tile?.latest).toMatchObject({ month: JAN });
    expect(tile?.period).toEqual({ start: "2025-12-15", end: "2026-01-31" });
    expect(
      await engagementTile(db, hr, {
        within: { start: "2024-01-01", end: "2024-06-30" },
      }),
    ).toBeNull();
  });

  it("masks the month for direction", async () => {
    await seedData();
    const tile = await engagementTile(db, direction, { minGroupSize: 3 });
    expect(tile?.latest.hidden).toBe(true);
    expect(tile?.minGroupSize).toBe(3);
  });
});

describe("engagementFilterOptions", () => {
  it("offers the areas, accounts, projects, DMs and Santex Leads of the people with engagement", async () => {
    await seedData();
    await setOrgAttributes(ana, {
      account: "Cuenta A",
      project: "Proyecto A1",
      dm: "Marta Quiroga",
      santex_lead: "Nora Salas",
    });
    await setOrgAttributes(diego, { account: "Cuenta B" });

    const options = await engagementFilterOptions(db, hr);

    expect(options.departments).toEqual(["Datos", "Ingeniería"]);
    expect(options.org).toEqual({
      accounts: ["Cuenta A", "Cuenta B"],
      projects: ["Proyecto A1"],
      dms: ["Marta Quiroga"],
      santexLeads: ["Nora Salas"],
    });
    expect([options.firstMonth, options.lastMonth]).toEqual([JAN, FEB]);
  });

  it("does not offer direction the DMs or Santex Leads, and a manager only their reports'", async () => {
    await seedData();
    await setOrgAttributes(ana, {
      account: "Cuenta A",
      dm: "Marta Quiroga",
      santex_lead: "Nora Salas",
    });
    await setOrgAttributes(diego, { account: "Cuenta B" });

    const dir = await engagementFilterOptions(db, direction);
    expect(dir.org).toMatchObject({
      accounts: ["Cuenta A", "Cuenta B"],
      dms: [],
      santexLeads: [],
    });
    const mgr = await engagementFilterOptions(db, {
      personId: marta,
      role: "manager",
    });
    expect(mgr.org.accounts).toEqual(["Cuenta A"]);
    expect(mgr.departments).toEqual(["Ingeniería"]);
  });
});

// ---- quant (#117): the people behind a month (drill-down) ----
describe("engagementPeople", () => {
  it("People: the people of a month, of a segment, by name", async () => {
    await seedData();
    const all = await engagementPeople(db, hr, { month: JAN, segment: null });
    expect(all.map((p) => p.name)).toEqual([
      "Ana Prieto",
      "Bruno Soler",
      "Carla Rey",
      "Diego Paz",
    ]);
    expect(all[0]).toMatchObject({
      department: "Ingeniería",
      managerName: "Marta Quiroga",
      score: 0.9,
      segment: "alto",
    });
    const low = await engagementPeople(db, hr, { month: JAN, segment: "bajo" });
    expect(low.map((p) => p.name)).toEqual(["Diego Paz"]);
  });

  it("a manager: only their direct reports of that month", async () => {
    await seedData();
    const r = await engagementPeople(
      db,
      { personId: nora, role: "manager" },
      { month: JAN, segment: null },
    );
    expect(r.map((p) => p.name)).toEqual(["Diego Paz"]);
  });

  it("an employee is forbidden", async () => {
    await seedData();
    await expect(
      engagementPeople(
        db,
        { personId: ana, role: "employee" },
        { month: JAN, segment: null },
      ),
    ).rejects.toBeInstanceOf(ReviewError);
  });
});
