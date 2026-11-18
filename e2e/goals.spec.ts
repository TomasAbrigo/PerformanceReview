import { expect, test } from "@playwright/test";
import { actAsCookie } from "./act-as";
import {
  type AssessmentSubject,
  allGoalCount,
  assessmentSubject,
  cycleGoalCount,
  goalCount,
  goalOf,
  goalOfSomeoneElse,
  type GoalSubject,
} from "./assessments-data";

// Runs after the historical import (project "insights"): the cycle filter
// reads the goal snapshots the import leaves. The subject is a person of the
// imported cycle with goals (e2e/assessments-data.ts).
let subject: AssessmentSubject;
let goal: GoalSubject;
test.beforeAll(async () => {
  subject = await assessmentSubject();
  goal = await goalOf(subject.personId);
});

const plural = (n: number) => (n === 1 ? "1 goal" : `${n} goals`);

test("People list every goal, filter them and page through them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es/goals");
  await expect(
    page.getByRole("heading", { level: 1, name: "Goals" }),
  ).toBeVisible();
  const total = await allGoalCount();
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(
    plural(total),
  );
  const states = page.getByRole("group", { name: "Goals por estado" });
  await expect(
    states.getByRole("link", { name: `Todos ${total}` }),
  ).toHaveAttribute("aria-current", "true");

  // By state: every row of the list is in it.
  const filters = page.getByRole("form", { name: "Filtros de goals" });
  await filters.locator('select[name="state"]').selectOption("completed");
  await filters.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/state=completed/);
  const rows = page.getByRole("table", { name: "Lista de goals" });
  await expect(rows.locator("[data-state]").first()).toBeVisible();
  await expect(
    rows.locator('[data-state]:not([data-state="completed"])'),
  ).toHaveCount(0);
  await expect(
    states.getByRole("link", { name: /^Completado \d+$/ }),
  ).toHaveAttribute("aria-current", "true");

  // By the goals of a cycle's snapshot.
  await page.goto("/es/goals");
  await filters
    .locator('select[name="cycle"]')
    .selectOption({ label: subject.cycleName });
  await filters.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/cycle=[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(
    plural(await cycleGoalCount(subject.cycleId)),
  );

  // By person.
  await page.goto("/es/goals");
  await filters.getByLabel("Persona").fill(subject.personName);
  await filters.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/q=/);
  const own = await goalCount(subject.personId);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(
    plural(own),
  );
  await expect(rows.getByText(subject.personName)).toHaveCount(own);

  // Paging: the first page is full, the next one has others.
  await page.goto("/es/goals");
  await expect(page.getByText(/^Página 1 de \d+$/)).toBeVisible();
  const first = await rows.locator("tbody tr").first().innerText();
  await page.getByRole("link", { name: "Siguiente" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText(/^Página 2 de \d+$/)).toBeVisible();
  expect(await rows.locator("tbody tr").first().innerText()).not.toBe(first);
});

test("a goal's page shows its summary, milestones and comments, and leads to the assessments that list it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es/goals");
  const filters = page.getByRole("form", { name: "Filtros de goals" });
  await filters.getByLabel("Persona").fill(goal.personName);
  await filters.getByRole("button", { name: "Aplicar" }).click();
  await page
    .getByRole("table", { name: "Lista de goals" })
    .getByRole("link", { name: goal.title })
    .first()
    .click();
  await expect(page).toHaveURL(/\/es\/goals\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: goal.title }),
  ).toBeVisible();
  const summary = page.getByTestId("goal-summary");
  await expect(summary.getByText(goal.personName)).toBeVisible();
  await expect(summary.getByRole("progressbar")).toBeVisible();
  await expect(summary.getByText("Creado")).toBeVisible();
  await expect(summary.getByText("Vence")).toBeVisible();
  await expect(summary.getByText("Finalizado")).toBeVisible();
  await expect(
    page.getByTestId("goal-milestones").locator("ol > li"),
  ).toHaveCount(goal.milestones);
  await expect(page.getByTestId("goal-comments")).toBeVisible();

  // The way to the assessment of the period it is part of.
  await page
    .getByRole("link", { name: `Ver el assessment de ${subject.cycleName}` })
    .click();
  await expect(page).toHaveURL(
    /\/es\/assessments\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/,
  );
  await expect(page.getByTestId("assessment-goals")).toContainText(goal.title);
});

test("an employee only sees their own goals", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAsCookie(page, { personId: subject.personId, role: "employee" });
  await page.goto("/es/goals");
  const own = await goalCount(subject.personId);
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(
    plural(own),
  );
  // Themself only: no person column, no person search.
  const filters = page.getByRole("form", { name: "Filtros de goals" });
  await expect(filters.getByLabel("Persona")).toHaveCount(0);
  const rows = page.getByRole("table", { name: "Lista de goals" });
  await expect(rows.getByRole("columnheader", { name: "Persona" })).toHaveCount(
    0,
  );
  await expect(rows.locator("tbody tr")).toHaveCount(own);

  // Somebody else's goal: no access, and nothing of it on the page.
  const other = await goalOfSomeoneElse(subject.personId);
  await page.goto(`/es/goals/${other.goalId}`);
  await expect(page.getByText(/No tenés acceso a este goal/)).toBeVisible();
  await expect(page.getByText(other.title)).toHaveCount(0);

  // And, as the employee, no analysis in the navigation.
  await expect(
    page.getByRole("navigation", { name: "Secciones" }).getByRole("link", {
      name: "Vista ejecutiva",
    }),
  ).toHaveCount(0);
});

test("a manager sees their team's goals and not other people's", async ({
  page,
}) => {
  test.setTimeout(120_000);
  expect(subject.managerId).not.toBeNull();
  await page.goto("/es");
  await actAsCookie(page, { personId: subject.managerId, role: "manager" });
  await page.goto("/es/goals");
  const filters = page.getByRole("form", { name: "Filtros de goals" });
  await filters.getByLabel("Persona").fill(subject.personName);
  await filters.getByRole("button", { name: "Aplicar" }).click();
  const rows = page.getByRole("table", { name: "Lista de goals" });
  await expect(rows.locator("tbody tr").first()).toContainText(
    subject.personName,
  );
  // The whole company's goals are not theirs.
  await page.goto("/es/goals");
  const total = await allGoalCount();
  await expect(page.getByRole("heading", { level: 2 }).first()).not.toHaveText(
    plural(total),
  );
});
