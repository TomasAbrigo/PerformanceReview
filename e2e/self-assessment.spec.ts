import { expect, type Page, test } from "@playwright/test";
import {
  company,
  directReports,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

// Someone in the org on the snapshot day with no reports (so no other
// participant row mentions their name) and a name the selectors can pick.
const employee = find(
  employees,
  (e) => isActive(e) && hasUniqueName(e) && directReports(e).length === 0,
  "person with no reports and a unique name",
);
const employeeName = fullName(employee);

/** Uses the header "Actuar como" selector. */
async function actAs(page: Page, person: string | null, role: string) {
  const bar = page.getByRole("form", { name: "Actuar como" });
  if (person) await bar.getByLabel("Buscar persona").fill(person);
  await bar
    .getByLabel("Persona", { exact: true })
    .selectOption({ label: person ?? "Sin persona" });
  await bar.getByLabel("Rol").selectOption({ label: role });
  await bar.getByRole("button", { name: "Aplicar" }).click();
  await expect(bar.getByText(/Actuando como:/)).toContainText(
    person ?? "People",
  );
}

/** Launches a cycle with everyone active and moves it to collecting. */
async function collectingCycle(page: Page, name: string): Promise<string> {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill(company.asOf);
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  // Step 3 (template groups) is optional: skip it.
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-06-30");
  await page.getByLabel("Autoevaluación").fill("2022-07-15");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  const url = page.url();
  await page.getByRole("button", { name: "Pasar a Recolección" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(3);
  return url;
}

test("an employee fills and submits their self assessment; HR unlocks it", async ({
  page,
}) => {
  const name = `Autoevaluación e2e ${Date.now()}`;
  const cycleUrl = await collectingCycle(page, name);

  // Act as the employee: the task shows in the inbox.
  await actAs(page, employeeName, "Empleado");
  await page.goto("/es/me");
  await expect(
    page.getByRole("heading", { level: 1, name: "Mis tareas" }),
  ).toBeVisible();
  const task = page
    .getByRole("listitem")
    .filter({ hasText: `Autoevaluación: ${name}` });
  await expect(task).toContainText("Vence el");
  await task.getByRole("link", { name: "Completar" }).click();

  // Fill every question (autosaved on blur) and submit.
  await expect(page).toHaveURL(/\/self$/);
  await expect(
    page.getByRole("heading", { level: 1, name: `Autoevaluación: ${name}` }),
  ).toBeVisible();
  const boxes = page.getByRole("textbox", { name: /\?|\./ });
  const count = await boxes.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await boxes.nth(i).fill(`Respuesta ${i + 1}`);
    await boxes.nth(i).blur();
  }
  await expect(page.getByText("Borrador guardado")).toBeVisible();
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(page.getByText(/Enviado el/)).toBeVisible();
  await expect(page.getByText("Respuesta 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /\?|\./ })).toHaveCount(0);

  // The task is gone from the inbox.
  await page.goto("/es/me");
  await expect(
    page.getByRole("heading", { level: 1, name: "Mis tareas" }),
  ).toBeVisible();
  await expect(
    // Only tasks: the cycle's phase-change notifications also name it.
    page.getByRole("listitem").filter({ hasText: `Autoevaluación: ${name}` }),
  ).toHaveCount(0);

  // HR unlocks it from the cycle page.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto(cycleUrl);
  const row = page
    .getByRole("table", { name: "Participantes" })
    .getByRole("row")
    .filter({ hasText: employeeName });
  await expect(row.getByText("Enviada")).toBeVisible();
  await row.getByRole("button", { name: "Desbloquear" }).click();
  await row.getByLabel("Motivo del desbloqueo").fill("Agregar un ejemplo");
  await row.getByRole("button", { name: "Confirmar desbloqueo" }).click();
  await expect(row.getByText("Borrador")).toBeVisible();

  // The employee sees an editable draft again, with their answers.
  await actAs(page, employeeName, "Empleado");
  await page.goto(cycleUrl + "/self");
  await expect(
    page.getByRole("heading", { level: 1, name: `Autoevaluación: ${name}` }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /\?|\./ }).first(),
  ).toHaveValue("Respuesta 1");
});
