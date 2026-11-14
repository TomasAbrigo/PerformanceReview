import { expect, type Page, test } from "@playwright/test";

/**
 * Creates and launches a cycle for the given people (snapshot 2022-06-01), with
 * a self due date, and moves it to collecting (where manager reviews exist).
 */
async function collectingCycle(page: Page, name: string, people: string[]) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill("2022-06-01");
  await page.getByLabel("Personas individuales").check();
  for (const person of people) await page.getByLabel(person).check();
  await expect(page.getByText(/\d+ personas? coinciden?/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Plantilla").selectOption({
    label: "Evaluación de fin de año",
  });
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
    ["Ana García"],
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

  // Add Bruno mid-cycle: he gets a snapshot today and his pending reviews.
  await page.getByRole("link", { name: "Participantes y evaluadores" }).click();
  await expect(page).toHaveURL(/\/participants$/);
  const add = page.getByRole("form", { name: "Agregar un participante" });
  await add.getByLabel("Persona", { exact: true }).selectOption({
    label: "Bruno Pérez",
  });
  await add.getByRole("button", { name: "Agregar participante" }).click();
  const table = page.getByRole("table", { name: "Participantes" });
  const bruno = table.getByRole("row").filter({ hasText: "Bruno Pérez" });
  await expect(bruno).toBeVisible();
  // His snapshot manager is today's: Ana.
  await expect(bruno.getByRole("cell").nth(1)).toHaveText("Ana García");

  // Ana is the CEO: her manager review has no assessor until one is assigned.
  const ana = table.getByRole("row").filter({ hasText: "Ana García" }).first();
  await expect(ana.getByText("Sin evaluador")).toBeVisible();
  await ana.getByRole("button", { name: "Asignar evaluador" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Asignar un evaluador a Ana García",
  });
  await expect(
    dialog.getByRole("radio", { name: "Es un evaluador adicional" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Evaluador", { exact: true })
    .selectOption({ label: "Bruno Pérez" });
  await dialog.getByRole("button", { name: "Asignar" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(ana.getByText("Sin evaluador")).toHaveCount(0);

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
    ["Bruno Pérez"],
  );
  await page.goto(`${cycleUrl}/participants`);
  const bruno = page
    .getByRole("table", { name: "Participantes" })
    .getByRole("row")
    .filter({ hasText: "Bruno Pérez" });
  // His self review is the first "complete on behalf" link of the row.
  await bruno
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
    .fill("Bruno está de licencia");
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(page.getByText(/Enviado el/)).toBeVisible();

  // The participants table shows it submitted on behalf; the log records it.
  await page.goto(`${cycleUrl}/participants`);
  const row = page
    .getByRole("table", { name: "Participantes" })
    .getByRole("row")
    .filter({ hasText: "Bruno Pérez" });
  await expect(row.getByText("Completada en nombre de otro")).toBeVisible();
  await page.goto(`${cycleUrl}/audit`);
  const entries = entriesOf(page);
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText("Completada en nombre de otro");
  await expect(entries.first()).toContainText("Bruno está de licencia");
});
