import { expect, test } from "@playwright/test";
import type { FixtureGoal } from "../src/fixtures/company";
import {
  byId,
  directReports,
  employees,
  find,
  fullName,
  goalsOf,
  hasUniqueName,
  isActive,
} from "./seed-data";

// Only the goals of people who are still employed are ingested (#6), and the
// specs navigate by name, so they pick active people with a unique name.
const candidates = employees.filter((e) => isActive(e) && hasUniqueName(e));

// One sharee, and one that is a person (a rehire still in the queue is not).
const sharedWithOnePerson = (g: FixtureGoal) =>
  g.sharedWithEmployeeIds.length === 1 && byId.has(g.sharedWithEmployeeIds[0]);

const STATUS_ES = {
  in_progress: "En curso",
  completed: "Completado",
  closed: "Cerrado",
} as const;

const commentsEs = (n: number) =>
  n === 0 ? "Sin comentarios" : n === 1 ? "1 comentario" : `${n} comentarios`;
const objetivos = (n: number) => `${n} ${n === 1 ? "objetivo" : "objetivos"}`;

test("person detail lists goals by due date with progress and milestones", async ({
  page,
}) => {
  const owner = find(
    candidates,
    (e) => {
      const goals = goalsOf(e);
      return (
        goals.length >= 3 &&
        goals.some(
          (g) =>
            g.status === "in_progress" &&
            (g.milestones?.length ?? 0) >= 2 &&
            g.commentCount > 0,
        ) &&
        goals.some((g) => g.status === "completed")
      );
    },
    "person with 3+ goals incl. an in-progress one with milestones and comments, and a completed one",
  );
  const goals = goalsOf(owner);
  const withMilestones = find(
    goals,
    (g) =>
      g.status === "in_progress" &&
      (g.milestones?.length ?? 0) >= 2 &&
      g.commentCount > 0,
    "goal",
  );
  const completed = find(goals, (g) => g.status === "completed", "goal");

  await page.goto("/es/people");
  await page.getByRole("link", { name: fullName(owner), exact: true }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Objetivos" }),
  ).toBeVisible();
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(goals.length);
  await expect(cards.getByRole("heading")).toHaveText(
    goals.map((g) => g.title),
  );

  const card = cards.filter({ hasText: withMilestones.title }).first();
  await expect(
    card.getByText(STATUS_ES.in_progress, { exact: true }),
  ).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    String(withMilestones.percentComplete),
  );
  const milestones = withMilestones.milestones!;
  const done = milestones.filter((m) => m.completedDateTime !== null).length;
  await expect(
    card.getByText(`${done} de ${milestones.length} hitos`),
  ).toBeVisible();
  const list = card.getByRole("list", { name: "Hitos" });
  await expect(list.getByRole("listitem")).toHaveCount(milestones.length);
  for (const m of milestones) await expect(list).toContainText(m.title);
  await expect(
    card.getByText(commentsEs(withMilestones.commentCount)),
  ).toBeVisible();

  await expect(
    cards
      .filter({ hasText: completed.title })
      .first()
      .getByText(STATUS_ES.completed, { exact: true }),
  ).toBeVisible();
});

test("closed and shared goals show up on the owner's page", async ({
  page,
}) => {
  const owner = find(
    candidates,
    (e) =>
      goalsOf(e).some((g) => g.status === "closed") &&
      goalsOf(e).some(sharedWithOnePerson),
    "person with a closed goal and a goal shared with one person",
  );
  const goals = goalsOf(owner);
  const closed = find(goals, (g) => g.status === "closed", "closed goal");
  const shared = find(goals, sharedWithOnePerson, "shared goal");
  const sharee = byId.get(shared.sharedWithEmployeeIds[0])!;

  await page.goto("/en/people");
  await page.getByRole("link", { name: fullName(owner), exact: true }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Goals" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: closed.title })
      .first()
      .getByText("Closed", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: shared.title })
      .first()
      .getByText(`Shared with ${fullName(sharee)}`),
  ).toBeVisible();
});

test("a person without goals shows the empty state", async ({ page }) => {
  const nobody = find(
    candidates,
    (e) => goalsOf(e).length === 0,
    "person without goals",
  );
  await page.goto("/es/people");
  await page.getByRole("link", { name: fullName(nobody), exact: true }).click();

  await expect(
    page.getByText("Todavía no hay objetivos importados."),
  ).toBeVisible();
});

test("team view groups the goals of the manager's direct reports", async ({
  page,
}) => {
  const manager = find(
    candidates,
    (e) => {
      const reports = directReports(e);
      return (
        reports.length >= 2 &&
        reports.every(hasUniqueName) &&
        reports.some((r) => goalsOf(r).length > 0)
      );
    },
    "manager with 2+ direct reports, all with unique names",
  );
  const reports = directReports(manager);

  await page.goto("/es");
  await page.getByRole("link", { name: "Objetivos del equipo" }).click();
  await expect(page).toHaveURL(/\/es\/team\/goals$/);
  await page
    .getByRole("link", { name: fullName(manager), exact: true })
    .click();
  await expect(page).toHaveURL(/team\/goals\?manager=/);

  await expect(
    page.getByRole("heading", { level: 1, name: "Objetivos del equipo" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `Objetivos de los reportes directos de ${fullName(manager)}.`,
    ),
  ).toBeVisible();

  // One group per current report; people who left are not in it.
  await expect(page.getByRole("region")).toHaveCount(reports.length);
  for (const report of reports) {
    const goals = goalsOf(report);
    const group = page.getByRole("region", { name: fullName(report) });
    await expect(group.getByRole("article")).toHaveCount(goals.length);
    if (goals.length > 0) {
      await expect(
        group.getByText(objetivos(goals.length), { exact: true }),
      ).toBeVisible();
      await expect(
        group.getByRole("article").first().getByRole("heading"),
      ).toHaveText(goals[0].title);
    } else {
      await expect(group.getByText("Sin objetivos.")).toBeVisible();
    }
  }
  const leavers = employees.filter(
    (e) => !isActive(e) && e.managerId === manager.id && hasUniqueName(e),
  );
  for (const gone of leavers) {
    await expect(page.getByText(fullName(gone))).toHaveCount(0);
  }

  const withGoals = find(reports, (r) => goalsOf(r).length > 0, "report");
  await page
    .getByRole("region", { name: fullName(withGoals) })
    .getByRole("link", { name: fullName(withGoals) })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: fullName(withGoals) }),
  ).toBeVisible();
});

test("manager picker lists managers; an unknown manager is not found", async ({
  page,
}) => {
  const manager = find(
    candidates,
    (e) => directReports(e).length > 0,
    "manager",
  );
  const individual = find(
    candidates,
    (e) => directReports(e).length === 0,
    "person without direct reports",
  );

  await page.goto("/en/team/goals");
  await expect(
    page.getByText("Choose a manager to see their team's goals."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: fullName(manager), exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: fullName(individual), exact: true }),
  ).toHaveCount(0);

  // Streamed pages answer 200 before not-found is known: check the content.
  await page.goto(
    "/en/team/goals?manager=00000000-0000-4000-8000-000000000000",
  );
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});
