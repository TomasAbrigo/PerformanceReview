import { expect, type Page, test } from "@playwright/test";
import {
  byId,
  company,
  directReports,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

// An employee with no reports (so no other row mentions them), whose manager
// is a person too: the manager at the snapshot is the current one.
const employee = find(
  employees,
  (e) =>
    isActive(e) &&
    hasUniqueName(e) &&
    directReports(e).length === 0 &&
    e.managerId !== null &&
    byId.has(e.managerId) &&
    isActive(byId.get(e.managerId)!) &&
    hasUniqueName(byId.get(e.managerId)!),
  "person with no reports and a manager with a unique name",
);
const manager = byId.get(employee.managerId!)!;
const employeeName = fullName(employee);
const managerName = fullName(manager);

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

const HIDDEN = "Nota privada para People";

/** Clones the year-end template adding a manager question hidden to the employee. */
async function templateWithHiddenQuestion(page: Page, name: string) {
  await page.goto("/es/settings/templates");
  const row = page.getByRole("row").filter({
    has: page.getByRole("link", {
      name: "Evaluación de fin de año",
      exact: true,
    }),
  });
  await row.getByRole("button", { name: "Clonar template" }).first().click();
  await expect(page).toHaveURL(/\/es\/settings\/templates\/[0-9a-f-]{36}$/);
  const nameForm = page.getByRole("form", { name: "Guardar nombre" });
  await nameForm.getByLabel("Nombre (español)").fill(name);
  await nameForm.getByLabel("Nombre (inglés)").fill(`${name} (en)`);
  await nameForm.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const form = page.getByRole("form", { name: "Nueva pregunta" }).nth(1);
  await form.getByLabel("Texto (español)").fill(HIDDEN);
  await form.getByLabel("Texto (inglés)").fill("Private note for People");
  await form.getByLabel("Manager", { exact: true }).check();
  await form.getByLabel("Visible para la persona evaluada").uncheck();
  await form.getByRole("button", { name: "Agregar pregunta" }).click();
  await expect(page.getByText(HIDDEN)).toBeVisible();
}

/** Launches a cycle (no calibration) with that template, moves it to collecting. */
async function collectingCycle(
  page: Page,
  name: string,
  template: string,
): Promise<string> {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill(company.asOf);
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Plantilla").selectOption({ label: template });
  await page.getByLabel("Calibración", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Siguiente" }).click();
  // Template groups are optional: skip the step.
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-06-30");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  const url = page.url();
  await moveTo(page, "Recolección", 3);
  return url;
}

/** HR moves the open cycle page to the next phase. */
async function moveTo(page: Page, phase: string, transitions: number) {
  await page.getByRole("button", { name: `Pasar a ${phase}` }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(transitions);
}

/** Answers every text and rating question of the open form and submits. */
async function fillAndSubmit(page: Page) {
  const boxes = page.getByRole("textbox", { name: /\?|\.|People/ });
  await expect(boxes.first()).toBeVisible();
  const count = await boxes.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await boxes.nth(i).fill(`Respuesta ${i + 1}`);
    await boxes.nth(i).blur();
  }
  const groups = page.getByRole("radiogroup");
  for (let i = 0; i < (await groups.count()); i++) {
    await groups.nth(i).getByRole("radio").first().check();
  }
  await expect(page.getByText("Borrador guardado")).toBeVisible();
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(page.getByText(/Enviado el/)).toBeVisible();
}

test("manager reviews under double blind, shares, and the employee sees only visible answers", async ({
  page,
}) => {
  const stamp = Date.now();
  const template = `Fin de año e2e ${stamp}`;
  const name = `Manager e2e ${stamp}`;
  await templateWithHiddenQuestion(page, template);
  const cycleUrl = await collectingCycle(page, name, template);

  // The employee submits their self assessment.
  await actAs(page, employeeName, "Empleado");
  await page.goto("/es/me");
  await page
    .getByRole("listitem")
    .filter({ hasText: `Autoevaluación: ${name}` })
    .getByRole("link", { name: "Completar" })
    .click();
  await expect(page).toHaveURL(/\/self$/);
  await fillAndSubmit(page);

  // Their manager (at the snapshot) opens the team.
  await actAs(page, managerName, "Manager");
  await page.goto("/es/team");
  const row = page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ hasText: employeeName });
  await expect(row).toContainText("Enviada");
  await row.getByRole("link", { name: "Evaluar" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Evaluación de ${employeeName}`,
    }),
  ).toBeVisible();

  // Double blind: the self assessment is hidden until she submits hers.
  const aside = page.getByRole("complementary", { name: "Autoevaluación" });
  await expect(aside.getByText(/se mostrará cuando ambos/)).toBeVisible();
  await expect(aside.getByText("Respuesta 1")).toHaveCount(0);
  await expect(page.getByText("El empleado no verá")).toBeVisible();
  await fillAndSubmit(page);
  await expect(aside.getByText("Respuesta 1")).toBeVisible();

  // Not shareable before the sharing phase.
  await expect(
    page.getByText("Aún no compartida con el empleado."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compartir con el empleado" }),
  ).toHaveCount(0);
  const managerUrl = page.url();

  // HR moves the cycle to sharing.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto(cycleUrl);
  await moveTo(page, "Revisión del manager", 4);
  await moveTo(page, "Compartir resultados", 5);

  // The manager shares with the employee.
  await actAs(page, managerName, "Manager");
  await page.goto(managerUrl);
  await page.getByRole("button", { name: "Compartir con el empleado" }).click();
  await expect(page.getByText(/Compartida el/)).toBeVisible();

  // The employee sees the shared review, without the hidden question.
  await actAs(page, employeeName, "Empleado");
  await page.goto("/es/me");
  await page
    .getByRole("listitem")
    .filter({ hasText: `Evaluación compartida: ${name}` })
    .getByRole("link", { name: "Ver" })
    .click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Evaluación de tu manager: ${name}`,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Calificación general de desempeño"),
  ).toBeVisible();
  await expect(page.getByText(HIDDEN)).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
});
