import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { employment, goalMilestone, person } from "@/db/schema";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { runGoalIngest } from "./ingest";
import { listDirectReports } from "./direct-reports";
import { getTeamGoals, listPersonGoals } from "./queries";
import {
  editJson,
  resetGoalTables,
  type AggregateJson,
  type EmployeesPageJson,
} from "./test-support";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

let dir: string;

const reset = resetGoalTables;
const editGoals = (file: string, edit: (json: AggregateJson) => void) =>
  editJson(dir, file, edit);
const editEmployees = (file: string, edit: (json: EmployeesPageJson) => void) =>
  editJson(dir, file, edit);

const ingestAll = async () => {
  const adapter = new FixtureAdapter(dir);
  await runIngest({ adapter, entity: "employee", db });
  await runGoalIngest({ adapter, db });
};

const personId = async (displayName: string) => {
  const [row] = await db
    .select()
    .from(person)
    .where(eq(person.displayName, displayName));
  return row.id;
};

describe("goal queries", () => {
  beforeEach(async () => {
    await reset();
    dir = await mkdtemp(path.join(tmpdir(), "goals-queries-"));
    await cp(FIXTURES, dir, { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  afterAll(async () => {
    await reset();
    await closeDb();
  });

  describe("listPersonGoals", () => {
    it("lists a person's goals by due date with milestones, comment counts and shares", async () => {
      await ingestAll();

      const goals = await listPersonGoals(db, await personId("Bruno Pérez"));

      expect(goals.map((g) => [g.title, g.dueDate])).toEqual([
        ["Obtener la certificación AWS", "2026-09-30"],
        ["Reducir el tiempo de primera respuesta de soporte", "2026-12-31"],
        ["Documentar los runbooks de guardia", "2027-02-28"],
      ]);
      const [done, support, runbooks] = goals;
      expect(done).toMatchObject({
        status: "completed",
        percentComplete: 100,
        completionDate: "2026-09-20",
        milestones: [],
      });
      expect(support).toMatchObject({
        status: "in_progress",
        percentComplete: 55,
        commentCount: 1,
        sharedWith: [],
      });
      expect(
        support.milestones.map((m) => [m.title, m.completedAt !== null]),
      ).toEqual([
        ["Medir la línea de base", true],
        ["Automatizar el triage", true],
        ["Cubrir el turno noche", false],
      ]);
      expect(runbooks).toMatchObject({
        description: null,
        milestones: [],
        commentCount: 0,
      });
    });

    it("includes closed goals and names who a goal is shared with", async () => {
      await ingestAll();

      const goals = await listPersonGoals(db, await personId("Ana García"));

      expect(goals.map((g) => [g.title, g.status])).toEqual([
        ["Migrar legajos al nuevo sistema", "closed"],
        ["Definir el plan de carrera del área", "in_progress"],
      ]);
      expect(goals[1].sharedWith).toEqual([
        { personId: await personId("Bruno Pérez"), displayName: "Bruno Pérez" },
      ]);
    });

    it("puts goals without a due date last and hides soft-deleted milestones", async () => {
      await editGoals("goals/102.json", (json) => {
        json.goals.push({
          id: 9104,
          title: "Sin fecha",
          percentComplete: 5,
          status: "in_progress",
          dueDate: null,
          milestones: null,
        });
      });
      await ingestAll();
      await db
        .update(goalMilestone)
        .set({ deletedAt: new Date() })
        .where(eq(goalMilestone.sourceId, "5103"));

      const goals = await listPersonGoals(db, await personId("Bruno Pérez"));

      expect(goals.at(-1)).toMatchObject({ title: "Sin fecha", dueDate: null });
      const support = goals.find((g) => g.title.startsWith("Reducir"))!;
      expect(support.milestones.map((m) => m.title)).toEqual([
        "Medir la línea de base",
        "Automatizar el triage",
      ]);
    });

    it("returns nothing for a person without goals", async () => {
      await ingestAll();

      expect(await listPersonGoals(db, await personId("Carla Romero"))).toEqual(
        [],
      );
    });
  });

  describe("listDirectReports", () => {
    it("derives reports from the supervisor in the employee payload, active only", async () => {
      await ingestAll();

      const reports = await listDirectReports(db, await personId("Ana García"));

      // Carla also reports to Ana but was terminated in 2024.
      expect(reports.map((r) => r.displayName)).toEqual(["Bruno Pérez"]);
      expect(
        await listDirectReports(db, await personId("Bruno Pérez")),
      ).toEqual([]);
    });

    it("follows the latest payload when the supervisor changes", async () => {
      await ingestAll();
      await editEmployees("employees-page-1.json", (page) => {
        page.data[1].supervisorEId = null; // Bruno no longer reports to Ana
      });
      await rm(path.join(dir, "employee-102.json"));
      await runIngest({
        adapter: new FixtureAdapter(dir),
        entity: "employee",
        db,
      });

      expect(await listDirectReports(db, await personId("Ana García"))).toEqual(
        [],
      );
    });

    it("leaves out people whose employment was deleted", async () => {
      await ingestAll();
      await db
        .update(employment)
        .set({ deletedAt: new Date() })
        .where(eq(employment.sourceId, "102"));

      expect(await listDirectReports(db, await personId("Ana García"))).toEqual(
        [],
      );
    });
  });

  describe("getTeamGoals", () => {
    it("groups the goals of each direct report", async () => {
      await editEmployees("employees-page-2.json", (page) => {
        page.data.push({
          id: 104,
          employeeNumber: "0004",
          displayName: "Diego Sosa",
          workEmail: "diego.sosa@example.com",
          status: "Active",
          hireDate: "2024-01-15",
          terminationDate: null,
          supervisorEId: 101,
        });
      });
      await writeFile(
        path.join(dir, "goals/104.json"),
        JSON.stringify({
          goals: [
            {
              id: 9301,
              title: "Cerrar el onboarding",
              percentComplete: 30,
              status: "in_progress",
              dueDate: "2026-11-30",
              milestones: null,
            },
          ],
        }),
      );
      await ingestAll();

      const team = await getTeamGoals(db, await personId("Ana García"));

      expect(team?.manager.displayName).toBe("Ana García");
      expect(team?.reports.map((r) => r.person.displayName)).toEqual([
        "Bruno Pérez",
        "Diego Sosa",
      ]);
      expect(team?.reports[0].goals).toHaveLength(3);
      expect(team?.reports[1].goals.map((g) => g.title)).toEqual([
        "Cerrar el onboarding",
      ]);
    });

    it("lists a direct report with no goals as an empty group", async () => {
      await ingestAll();
      await db.execute(
        sql`TRUNCATE goal_share, goal_comment, goal_milestone, goal CASCADE`,
      );

      const team = await getTeamGoals(db, await personId("Ana García"));

      expect(team?.reports).toEqual([
        {
          person: expect.objectContaining({ displayName: "Bruno Pérez" }),
          goals: [],
        },
      ]);
    });

    it("has no reports for someone who manages nobody, and no team for an unknown id", async () => {
      await ingestAll();

      expect(
        (await getTeamGoals(db, await personId("Bruno Pérez")))?.reports,
      ).toEqual([]);
      expect(await getTeamGoals(db, "not-a-uuid")).toBeNull();
      expect(
        await getTeamGoals(db, "00000000-0000-4000-8000-000000000000"),
      ).toBeNull();
    });
  });
});
