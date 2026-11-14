import { expect, type Page, test } from "@playwright/test";

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
const FOLLOW_UP = "Acordamos revisar los objetivos en un mes";
const ACK_NOTE = "Gracias, lo leí con atención";

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

/** Launches a cycle with that template and moves it to collecting. */
async function collectingCycle(page: Page, name: string, template: string) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill("2022-06-01");
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Plantilla").selectOption({ label: template });
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-06-30");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Pasar a Recolección" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(3);
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

test("compare, follow-up note, acknowledgement and history of a shared review", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const template = `Comparación e2e ${stamp}`;
  const name = `Comparación ${stamp}`;
  await templateWithHiddenQuestion(page, template);
  await collectingCycle(page, name, template);

  // Bruno submits his self assessment.
  await actAs(page, "Bruno Pérez", "Empleado");
  await page.goto("/es/me");
  await page
    .getByRole("listitem")
    .filter({ hasText: `Autoevaluación: ${name}` })
    .getByRole("link", { name: "Completar" })
    .click();
  await fillAndSubmit(page);

  // Carla (his manager at the snapshot) submits hers and shares it.
  await actAs(page, "Carla Romero", "Manager");
  await page.goto("/es/team");
  const teamRow = page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ hasText: "Bruno Pérez" });
  await teamRow.getByRole("link", { name: "Evaluar" }).click();
  await fillAndSubmit(page);
  await page.getByRole("button", { name: "Compartir con el empleado" }).click();
  await expect(page.getByText(/Compartida el/)).toBeVisible();

  // She opens the side-by-side comparison from the form.
  await page.getByRole("link", { name: "Comparar" }).click();
  await expect(page).toHaveURL(/\/compare\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Comparación: Bruno Pérez" }),
  ).toBeVisible();
  const hiddenRow = page.getByRole("row").filter({ hasText: HIDDEN });
  await expect(hiddenRow).toBeVisible();
  await expect(hiddenRow.getByText("El empleado no verá esto")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Respuesta 1" }).first(),
  ).toBeVisible();

  // "Employee view" hides what the employee cannot see (screen sharing).
  const toggle = page.getByRole("checkbox", { name: "Vista del empleado" });
  await toggle.check();
  await expect(page.getByText(HIDDEN)).toHaveCount(0);
  await expect(
    page.getByText("Mostrando solo lo que verá el empleado."),
  ).toBeVisible();
  await toggle.uncheck();
  await expect(page.getByText(HIDDEN)).toBeVisible();

  // Follow-up note after the conversation; the acknowledgement is pending.
  await expect(
    page.getByText(/El empleado puede acusar recibo hasta el/),
  ).toBeVisible();
  await page.getByLabel("Nueva nota de seguimiento").fill(FOLLOW_UP);
  await page.getByRole("button", { name: "Agregar nota" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: FOLLOW_UP }),
  ).toBeVisible();

  // Bruno sees the note and acknowledges with a note.
  await actAs(page, "Bruno Pérez", "Empleado");
  await page.goto("/es/me");
  await page
    .getByRole("listitem")
    .filter({ hasText: `Acusar recibo: ${name}` })
    .getByRole("link", { name: "Acusar recibo" })
    .click();
  await expect(page).toHaveURL(/\/result#acknowledge$/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Evaluación de tu manager: ${name}`,
    }),
  ).toBeVisible();
  await expect(page.getByText(HIDDEN)).toHaveCount(0);
  await expect(page.getByText(FOLLOW_UP)).toBeVisible();
  await page.getByLabel("Nota (opcional)").fill(ACK_NOTE);
  await page.getByRole("button", { name: "Acusar recibo" }).click();
  await expect(page.getByText(/Acusaste recibo el/)).toBeVisible();
  await expect(page.getByText(`Tu nota: ${ACK_NOTE}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Acusar recibo" })).toHaveCount(
    0,
  );

  // The task is gone from /me, and the cycle shows in the history.
  await page.goto("/es/me");
  await expect(
    page.getByRole("heading", { level: 1, name: "Mis tareas" }),
  ).toBeVisible();
  await expect(page.getByText(`Acusar recibo: ${name}`)).toHaveCount(0);
  await page
    .getByRole("link", { name: "Mi historial de evaluaciones" })
    .click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Evaluaciones de Bruno Pérez",
    }),
  ).toBeVisible();
  const card = page.getByRole("article", { name });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("Manager en ese momento: Carla Romero"),
  ).toBeVisible();
  await expect(
    card.getByText("Puesto y área en ese momento: Developer, Ingeniería"),
  ).toBeVisible();
  await expect(card.getByText(/Acuse de recibo el/)).toBeVisible();
  await card.getByText("Ver respuestas").click();
  await expect(card.getByText("Respuesta 1").first()).toBeVisible();
  await expect(card.getByText(HIDDEN)).toHaveCount(0);

  // The manager sees the acknowledgement and its note.
  await actAs(page, "Carla Romero", "Manager");
  await page.goto("/es/team");
  await teamRow.getByRole("link", { name: "Comparar" }).click();
  await expect(page.getByText(/El empleado acusó recibo el/)).toBeVisible();
  await expect(page.getByText(`Nota del empleado: ${ACK_NOTE}`)).toBeVisible();

  // People reach the history from the person detail.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto("/es/people");
  await page.getByRole("link", { name: "Bruno Pérez" }).click();
  await page.getByRole("link", { name: "Evaluaciones" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Evaluaciones de Bruno Pérez",
    }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name })).toBeVisible();
});
