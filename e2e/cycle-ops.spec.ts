import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  byId,
  company,
  directReports,
  employees,
  escapeRegExp,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

// People come from the generated company (see seed-data.ts), not from names.
// The CEO: active, no manager, so their manager review has no assessor.
const ceo = find(
  employees,
  (e) => isActive(e) && hasUniqueName(e) && e.managerId === null,
  "active person without a manager",
);
// Someone with no reports and a manager who is a person too: joins mid-cycle
// (their snapshot manager is today's) and completes a review on behalf.
const leaf = (skip: string[] = []) =>
  find(
    employees,
    (e) =>
      isActive(e) &&
      hasUniqueName(e) &&
      !skip.includes(e.id) &&
      directReports(e).length === 0 &&
      e.managerId !== null &&
      byId.has(e.managerId) &&
      isActive(byId.get(e.managerId)!) &&
      hasUniqueName(byId.get(e.managerId)!),
    "person with no reports and a manager with a unique name",
  );
const added = leaf();
const assessor = leaf([added.id]);
const ceoName = fullName(ceo);
const addedName = fullName(added);
const addedManagerName = fullName(byId.get(added.managerId!)!);
const assessorName = fullName(assessor);

/**
 * Creates and launches a cycle for the given people (snapshot on the seed's
 * day), with a self due date, and moves it to collecting (where manager
 * reviews exist).
 */
async function collectingCycle(page: Page, name: string, people: string[]) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();
  // Filling the date again until the form took it keeps a slow hydration from
  // eating it.
  await expect(async () => {
    await page
      .getByLabel("Fecha de snapshot organizacional")
      .fill(company.asOf);
    await expect(page.getByText(/\d+ personas? coinciden?/)).toBeVisible({
      timeout: 3_000,
    });
  }).toPass();
  await page.getByLabel("Personas individuales").check();
  for (const person of people) {
    await page.getByLabel(person, { exact: true }).check();
  }
  await expect(page.getByText(/\d+ personas? coinciden?/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Plantilla").selectOption({
    label: "Evaluación de fin de año",
  });
  await page.getByRole("button", { name: "Siguiente" }).click();
  // Template groups are optional: skip the step.
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-06-30");
  await page.getByLabel("Autoevaluación").fill("2022-07-15");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Pasar a Recolección" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(3);
  return page.url();
}

/** The participants-table row of a person (their name starts the first cell). */
const participantRow = (page: Page, name: string): Locator =>
  page
    .getByRole("table", { name: "Participantes" })
    .getByRole("row")
    .filter({
      has: page
        .getByRole("cell")
        .first()
        .filter({
          hasText: new RegExp(`^${escapeRegExp(name)}`),
        }),
    });

const entriesOf = (page: Page) =>
  page
    .getByRole("table", { name: "Acciones administrativas" })
    .locator(":scope > tbody > tr");

// Each test launches a cycle and visits several routes `next dev` compiles on
// first hit.
test.describe.configure({ timeout: 120_000 });

test("extends a due date, adds a participant and assigns an assessor, all audited", async ({
  page,
}) => {
  const cycleUrl = await collectingCycle(
    page,
    `Operaciones e2e ${Date.now()}`,
    [ceoName],
  );

  // Extend the self-assessment due date (only forward).
  await page.getByRole("button", { name: "Extender una fecha límite" }).click();
  const extend = page.getByRole("form", { name: "Extender una fecha límite" });
  await extend.getByLabel("Nueva fecha límite").fill("2022-07-01");
  await extend.getByLabel("Motivo (opcional)").fill("Vacaciones del equipo");
  await extend.getByRole("button", { name: "Extender" }).click();
  await expect(
    page.getByText("La nueva fecha debe ser posterior"),
  ).toBeVisible();
  await extend.getByLabel("Nueva fecha límite").fill("2022-08-15");
  await extend.getByRole("button", { name: "Extender" }).click();
  await expect(page.getByText("Fecha límite extendida.")).toBeVisible();

  // Add someone mid-cycle: they get a snapshot today and their pending reviews.
  await page.getByRole("link", { name: "Participantes y evaluadores" }).click();
  await expect(page).toHaveURL(/\/participants$/);
  const add = page.getByRole("form", { name: "Agregar un participante" });
  await add.getByLabel("Persona", { exact: true }).selectOption({
    label: addedName,
  });
  await add.getByRole("button", { name: "Agregar participante" }).click();
  const joined = participantRow(page, addedName);
  await expect(joined).toBeVisible();
  // Their snapshot manager is today's.
  await expect(joined.getByRole("cell").nth(1)).toHaveText(addedManagerName);

  // The CEO has no manager: the manager review has no assessor until one is assigned.
  const boss = participantRow(page, ceoName);
  await expect(boss.getByText("Sin evaluador")).toBeVisible();
  await boss.getByRole("button", { name: "Asignar evaluador" }).click();
  const dialog = page.getByRole("dialog", {
    name: `Asignar un evaluador a ${ceoName}`,
  });
  await expect(
    dialog.getByRole("radio", { name: "Es un evaluador adicional" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Evaluador", { exact: true })
    .selectOption({ label: assessorName });
  await dialog.getByRole("button", { name: "Asignar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(boss.getByText("Sin evaluador")).toHaveCount(0);

  // The audit log lists the three actions, newest first, with before/after.
  await page.goto(`${cycleUrl}/audit`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Registro de auditoría/ }),
  ).toBeVisible();
  const entries = entriesOf(page);
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("Evaluador asignado");
  await expect(entries.nth(1)).toContainText("Participante agregado");
  await expect(entries.nth(2)).toContainText("Fecha límite extendida");
  await expect(entries.nth(2)).toContainText("Vacaciones del equipo");
  await expect(entries.nth(2).getByText("2022-08-15")).toBeAttached();

  // Filter by action.
  await page
    .getByLabel("Acción")
    .selectOption({ label: "Participante agregado" });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/action=participant_added/);
  await expect(entriesOf(page)).toHaveCount(1);
});

test("HR completes a self assessment on behalf of the employee, audited", async ({
  page,
}) => {
  const cycleUrl = await collectingCycle(
    page,
    `En nombre de otro e2e ${Date.now()}`,
    [addedName],
  );
  await page.goto(`${cycleUrl}/participants`);
  const row = participantRow(page, addedName);
  // Their self review is the first "complete on behalf" link of the row.
  await row
    .getByRole("link", { name: "Completar en nombre de" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/participants\/complete\//);
  await expect(
    page.getByText(/Estás completando esta evaluación/),
  ).toBeVisible();

  const texts = page.locator("textarea");
  await expect(texts.first()).toBeVisible();
  for (let i = 0; i < (await texts.count()); i++) {
    await texts.nth(i).fill(`Respuesta de People ${i + 1}`);
    await texts.nth(i).blur();
  }
  const groups = page.getByRole("radiogroup");
  for (let i = 0; i < (await groups.count()); i++) {
    await groups.nth(i).getByRole("radio").first().check();
  }
  // (The previous page stays in the DOM, hidden, while navigating.)
  await page
    .getByLabel("Motivo (opcional)")
    .filter({ visible: true })
    .fill("Está de licencia");
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(page.getByText(/Enviado el/)).toBeVisible();

  // The participants table shows it submitted on behalf; the log records it.
  await page.goto(`${cycleUrl}/participants`);
  await expect(
    participantRow(page, addedName).getByText("Completada en nombre de otro"),
  ).toBeVisible();
  await page.goto(`${cycleUrl}/audit`);
  const entries = entriesOf(page);
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText("Completada en nombre de otro");
  await expect(entries.first()).toContainText("Está de licencia");
});
