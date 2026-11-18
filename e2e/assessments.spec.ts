import { expect, type Page, test } from "@playwright/test";
import { actAsCookie } from "./act-as";
import {
  type AssessmentSubject,
  assessmentSubject,
  otherParticipant,
} from "./assessments-data";

// Runs after the historical import (project "insights" depends on
// "chromium", where e2e/historical-import.spec.ts imports Bamboo's raw
// assessments report): the Assessments area reads the imported cycle, with
// answers on both sides and a snapshot of the goals of the period. The subject
// is one person of it (e2e/assessments-data.ts).
let subject: AssessmentSubject;
test.beforeAll(async () => {
  subject = await assessmentSubject();
});

const DETAIL = /\/es\/assessments\/[0-9a-f-]{36}\/[0-9a-f-]{36}/;
const HIDDEN_FROM_EMPLOYEE = /Performance Score|Engagement Score/;

/** Picks the subject's cycle and searches them in the "Filtros de assessments" form. */
async function findSubject(page: Page) {
  await page.goto("/es/assessments");
  const filters = page.getByRole("form", { name: "Filtros de assessments" });
  await filters
    .locator('select[name="cycle"]')
    .selectOption({ label: subject.cycleName });
  await filters.getByLabel("Persona").fill(subject.personName);
  await filters.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/cycle=[0-9a-f-]{36}/);
}

test("People open a cycle, open a participant and read the self-assessment, the manager review and the goals of the period", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await findSubject(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Assessments" }),
  ).toBeVisible();

  // The list: one participant, with where each side stands.
  const list = page.getByRole("group", { name: "Participantes del ciclo" });
  await expect(list.getByRole("article")).toHaveCount(1);
  const row = list.getByRole("article", {
    name: new RegExp(subject.personName),
  });
  await expect(row.getByText("Enviada")).toHaveCount(2);
  await row.getByRole("link", { name: subject.personName }).click();
  await expect(page).toHaveURL(DETAIL);
  await expect(
    page.getByRole("heading", { level: 1, name: subject.personName }),
  ).toBeVisible();

  // The two forms side by side, each question with its answer.
  const self = page.getByTestId("assessment-self");
  const manager = page.getByTestId("assessment-manager");
  await expect(
    self.getByRole("heading", { name: "Autoevaluación" }),
  ).toBeVisible();
  await expect(
    manager.getByRole("heading", { name: "Evaluación del manager" }),
  ).toBeVisible();
  await expect(self.locator('[data-state="submitted"]')).toHaveText(/Enviada/);
  await expect(manager.locator('[data-state="submitted"]')).toHaveText(
    /Enviada/,
  );
  expect(await self.getByTestId("question").count()).toBeGreaterThan(2);
  // A closed answer: its value on the scale and the option's label.
  await expect(self.getByLabel(/^\d+ de \d+$/).first()).toHaveText(/^\d\/\d$/);
  // The manager's closed questions, hidden from the employee, are here.
  await expect(manager.getByText(/Performance Score/)).toBeVisible();
  await expect(manager.getByText(/Engagement Score/)).toBeVisible();
  await expect(manager.getByLabel(/^\d+ de 5$/).first()).toBeVisible();
  // The cycle's own questions are marked.
  await expect(self.getByText("Pregunta propia").first()).toBeVisible();

  // The goals of the period next to the form.
  const goals = page.getByTestId("assessment-goals");
  await expect(goals.getByRole("article")).toHaveCount(
    subject.goalTitles.length,
  );
  for (const title of new Set(subject.goalTitles)) {
    await expect(goals.getByText(title).first()).toBeVisible();
  }

  // Only People get the link to the person's analysis.
  await expect(
    page.getByRole("link", {
      name: `Ver el análisis de ${subject.personName}`,
    }),
  ).toHaveAttribute(
    "href",
    /\/insights\/indicators\/trend\?person=[0-9a-f-]{36}/,
  );
});

test("the employee view hides what the person would not read", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await findSubject(page);
  await page.getByRole("link", { name: subject.personName }).click();
  await expect(page).toHaveURL(DETAIL);
  const manager = page.getByTestId("assessment-manager");
  await expect(manager.getByText(HIDDEN_FROM_EMPLOYEE).first()).toBeVisible();

  await page.getByRole("link", { name: "Vista de empleado" }).click();
  await expect(page).toHaveURL(/view=employee/);
  await expect(
    page.getByText(`Así lo lee ${subject.personName}`),
  ).toBeVisible();
  await expect(page.getByText(HIDDEN_FROM_EMPLOYEE)).toHaveCount(0);
  // The self-assessment is still the person's own.
  await expect(
    page.getByTestId("assessment-self").getByTestId("question").first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Completa", exact: true }).click();
  await expect(page.getByText(HIDDEN_FROM_EMPLOYEE).first()).toBeVisible();
});

test("the goals of the period link to the goal, and the goal back to the assessment", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(
    `/es/assessments/${subject.cycleId}/${subject.participantId}`,
  );
  const goals = page.getByTestId("assessment-goals");
  const [first] = new Set(subject.goalTitles);
  await goals.getByRole("link", { name: first }).first().click();
  await expect(page).toHaveURL(/\/es\/goals\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: first }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: `Ver el assessment de ${subject.cycleName}` })
    .click();
  await expect(page).toHaveURL(DETAIL);
  await expect(page.getByTestId("assessment-goals")).toContainText(first);
});

test("an employee reads only their own assessment, never retention or engagement", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAsCookie(page, { personId: subject.personId, role: "employee" });
  await page.goto("/es/assessments");
  // Their own cycle, themself only: no person search, no manager column.
  const filters = page.getByRole("form", { name: "Filtros de assessments" });
  await expect(filters.getByLabel("Persona")).toHaveCount(0);
  await filters
    .locator('select[name="cycle"]')
    .selectOption({ label: subject.cycleName });
  await filters.getByRole("button", { name: "Aplicar" }).click();
  const list = page.getByRole("group", { name: "Participantes del ciclo" });
  await expect(list.getByRole("article")).toHaveCount(1);
  await list.getByRole("link", { name: subject.personName }).click();
  await expect(page).toHaveURL(DETAIL);

  // Their self-assessment in full, the goals of the period, no toggle to compare.
  const self = page.getByTestId("assessment-self");
  await expect(self.getByTestId("question").first()).toBeVisible();
  await expect(page.getByTestId("assessment-goals")).toBeVisible();
  await expect(page.getByRole("group", { name: "Vista" })).toHaveCount(0);
  // The manager review is theirs only once shared, and never the closed questions.
  if (!subject.managerShared) {
    await expect(
      page
        .getByTestId("assessment-manager")
        .getByText(/Todavía no está disponible para vos/),
    ).toBeVisible();
  }
  await expect(page.getByText(HIDDEN_FROM_EMPLOYEE)).toHaveCount(0);

  // Somebody else's assessment: no access.
  const other = await otherParticipant(
    subject.cycleId,
    subject.personId,
    subject.managerId,
  );
  await page.goto(`/es/assessments/${subject.cycleId}/${other.participantId}`);
  await expect(
    page.getByText(/No tenés acceso a este assessment/),
  ).toBeVisible();
  await expect(page.getByText(other.personName)).toHaveCount(0);
});

test("a manager reads their reports' assessments in full, and nobody else's", async ({
  page,
}) => {
  test.setTimeout(120_000);
  expect(subject.managerId).not.toBeNull();
  await page.goto("/es");
  await actAsCookie(page, { personId: subject.managerId, role: "manager" });
  await page.goto(`/es/assessments?cycle=${subject.cycleId}`);
  const list = page.getByRole("group", { name: "Participantes del ciclo" });
  await expect(
    list.getByRole("link", { name: subject.personName }),
  ).toBeVisible();
  const other = await otherParticipant(
    subject.cycleId,
    subject.personId,
    subject.managerId,
  );
  await expect(list.getByRole("link", { name: other.personName })).toHaveCount(
    0,
  );
  await list.getByRole("link", { name: subject.personName }).click();
  await expect(page).toHaveURL(DETAIL);
  // As the snapshot manager they read the closed questions.
  await expect(
    page.getByTestId("assessment-manager").getByText(/Performance Score/),
  ).toBeVisible();

  await page.goto(`/es/assessments/${subject.cycleId}/${other.participantId}`);
  await expect(
    page.getByText(/No tenés acceso a este assessment/),
  ).toBeVisible();
});
