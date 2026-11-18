import { expect, type Page, test } from "@playwright/test";
import { actAsCookie } from "./act-as";
import { goalOfSomeoneElse } from "./assessments-data";
import { goalRow, reportingPair, type ReportingPair } from "./goals-write-data";

// Goals written in the app (#105). They run after every spec that counts
// goals (project "goals-write"), one after the other: each step builds on the
// goal the one before created.
test.describe.configure({ mode: "serial" });

let pair: ReportingPair;
let stranger: string;
const title = `Goal de la prueba ${Date.now().toString(36)}`;
let goalId = "";

test.beforeAll(async () => {
  const found = await reportingPair();
  if (!found) throw new Error("the import left no person with a manager");
  pair = found;
  // Somebody else: as an employee they cannot read a goal that is not theirs.
  stranger = (await goalOfSomeoneElse(pair.personId)).personId;
});

const goalCard = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Lista de goals" })
    .getByRole("article")
    .filter({ hasText: name });

test("an employee creates a goal that is overdue until they complete it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAsCookie(page, { personId: pair.personId, role: "employee" });
  await page.goto("/es/goals");

  await page.getByRole("button", { name: "Nuevo goal" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo goal" });
  // The server refuses an empty title and a date that is not one.
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByText("Este campo es obligatorio.")).toBeVisible();
  await dialog.getByLabel("Título", { exact: true }).fill(title);
  await dialog.getByLabel("Descripción", { exact: true }).fill("Desde la app");
  await dialog.getByLabel("Fecha límite").fill("2020-01-31");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toBeHidden();

  // Past its due date and not completed: overdue.
  const card = goalCard(page, title);
  await expect(card).toBeVisible();
  await expect(card.locator('[data-state="overdue"]')).toBeVisible();
  expect(await goalRow(pair.personId, title)).toMatchObject({
    status: "in_progress",
    sourceSystem: "native",
  });

  await card.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(/\/es\/goals\/[0-9a-f-]{36}$/);
  goalId = page.url().split("/").pop()!;
  const summary = page.getByTestId("goal-summary");
  await expect(summary.locator('[data-state="overdue"]')).toBeVisible();

  // Progress, a milestone and its check.
  await page.getByLabel("Avance (%)").fill("40");
  await page.getByRole("button", { name: "Guardar avance" }).click();
  await expect(
    summary.getByRole("progressbar", { name: "40% completado" }),
  ).toBeVisible();
  await page.getByLabel("Agregar un hito").fill("Primer hito");
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  const milestones = page.getByTestId("goal-milestones");
  await expect(milestones.locator("ol > li")).toHaveCount(1);
  const check = milestones.getByRole("checkbox", { name: /Primer hito/ });
  await expect(check).toHaveAttribute("aria-checked", "false");
  await check.click();
  await expect(check).toHaveAttribute("aria-checked", "true");
  await expect(milestones.getByText(/Completado el/)).toBeVisible();

  // Edit the title.
  await summary.getByRole("button", { name: "Editar" }).click();
  const edit = page.getByRole("dialog", { name: "Editar goal" });
  await expect(edit.getByLabel("Título", { exact: true })).toHaveValue(title);
  await edit.getByLabel("Título", { exact: true }).fill(`${title} (editado)`);
  await edit.getByRole("button", { name: "Guardar" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `${title} (editado)` }),
  ).toBeVisible();

  // Complete it: 100 %, no longer overdue; close it; reopen: overdue again.
  await page.getByRole("button", { name: "Marcar como completo" }).click();
  await expect(summary.locator('[data-state="completed"]')).toBeVisible();
  await expect(
    summary.getByRole("progressbar", { name: "100% completado" }),
  ).toBeVisible();
  await expect(page.getByLabel("Avance (%)")).toHaveValue("100");
  await page.getByRole("button", { name: "Reabrir" }).click();
  await expect(summary.locator('[data-state="overdue"]')).toBeVisible();
  await page.getByRole("button", { name: "Cerrar goal" }).click();
  await expect(summary.locator('[data-state="closed"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Reabrir" })).toBeVisible();
  expect(await goalRow(pair.personId, `${title} (editado)`)).toMatchObject({
    status: "closed",
    milestones: 1,
  });
});

test("only the owner, their manager and People reach the controls", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAsCookie(page, { personId: stranger, role: "employee" });
  await page.goto(`/es/goals/${goalId}`);
  await expect(page.getByText(/No tenés acceso a este goal/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await expect(page.getByLabel("Avance (%)")).toHaveCount(0);

  // The owner's manager and People do see the controls.
  await actAsCookie(page, { personId: pair.managerId, role: "manager" });
  await page.goto(`/es/goals/${goalId}`);
  await expect(page.getByLabel("Avance (%)")).toBeVisible();
  await actAsCookie(page, { personId: null, role: "hr" });
  await page.goto(`/es/goals/${goalId}`);
  await expect(page.getByLabel("Avance (%)")).toBeVisible();

  // Direction reads aggregates only: it never reaches the goal.
  await actAsCookie(page, { personId: null, role: "direction" });
  await page.goto(`/es/goals/${goalId}`);
  await expect(page).toHaveURL(/\/es\/insights\/goals/);
});

test("a manager creates a goal for someone of their team", async ({ page }) => {
  test.setTimeout(120_000);
  const forReport = `Goal del manager ${Date.now().toString(36)}`;
  await page.goto("/es");
  await actAsCookie(page, { personId: pair.managerId, role: "manager" });
  await page.goto("/es/goals");
  await page.getByRole("button", { name: "Nuevo goal" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo goal" });
  await dialog.getByLabel("Persona").selectOption({ label: pair.personName });
  await dialog.getByLabel("Título", { exact: true }).fill(forReport);
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toBeHidden();
  expect(await goalRow(pair.personId, forReport)).toMatchObject({
    status: "in_progress",
    sourceSystem: "native",
  });

  // It is the report's goal: they see it, and may complete it.
  await actAsCookie(page, { personId: pair.personId, role: "employee" });
  await page.goto("/es/goals");
  await expect(goalCard(page, forReport)).toBeVisible();
});
