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

// An employee with no reports whose manager is an active person with a
// unique name (the manager at the snapshot is the current one).
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
const department = employee.department;

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

/** HR moves the open cycle page to the next phase. */
async function moveTo(page: Page, phase: string, transitions: number) {
  await page.getByRole("button", { name: `Pasar a ${phase}` }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(transitions);
}

/** Launches a year-end cycle with calibration and moves it to collecting. */
async function collectingCycle(page: Page, name: string) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill(company.asOf);
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page
    .getByLabel("Plantilla")
    .selectOption({ label: "Evaluación de fin de año" });
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

/** Answers the manager form: other ratings 2, the overall rating 1; submits. */
async function fillAndSubmit(page: Page) {
  const boxes = page.getByRole("textbox", { name: /\?|\./ });
  await expect(boxes.first()).toBeVisible();
  for (let i = 0; i < (await boxes.count()); i++) {
    await boxes.nth(i).fill(`Respuesta ${i + 1}`);
    await boxes.nth(i).blur();
  }
  const groups = page.getByRole("radiogroup");
  for (let i = 0; i < (await groups.count()); i++) {
    await groups.nth(i).getByRole("radio").nth(1).check();
  }
  await page
    .getByRole("radiogroup", { name: /Calificación general de desempeño/ })
    .getByRole("radio")
    .first()
    .check();
  await expect(page.getByText("Borrador guardado")).toBeVisible();
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(page.getByText(/Enviado el/)).toBeVisible();
}

test("HR calibrates by department, publishes, and the employee sees only the final rating", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const name = `Calibración e2e ${Date.now()}`;
  const cycleUrl = await collectingCycle(page, name);

  // The manager submits the review (overall rating: 1).
  await actAs(page, managerName, "Manager");
  await page.goto("/es/team");
  await page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ hasText: employeeName })
    .getByRole("link", { name: "Evaluar" })
    .click();
  await fillAndSubmit(page);

  // HR moves to calibration and opens it.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto(cycleUrl);
  await moveTo(page, "Revisión del manager", 4);
  await moveTo(page, "Calibración", 5);
  await page.getByRole("link", { name: "Calibración" }).click();
  await expect(page).toHaveURL(/\/calibration$/);

  // Group by department.
  await page.getByLabel("Nombre").fill(`Área ${department}`);
  await page.getByLabel("Tipo").selectOption({ label: "Por área" });
  await page.getByLabel("Criterio").selectOption({ label: department });
  await page.getByRole("button", { name: "Crear grupo" }).click();
  const row = page.getByRole("row").filter({ hasText: employeeName });
  await expect(row).toContainText("Necesita desarrollo");

  // Histogram of the department: the employee counted at 1 before.
  const chart = page.getByRole("region", { name: "Distribución de ratings" });
  const deptChart = chart.getByRole("img", {
    name: new RegExp(`^${department}:`),
  });
  await expect(deptChart).toHaveAccessibleName(/Necesita desarrollo [1-9]/);

  // Propose 3 with a reason.
  await row.getByRole("combobox").selectOption({ value: "3" });
  await row
    .getByPlaceholder("Motivo del cambio (obligatorio)")
    .fill("Impacto subestimado");
  await row.getByRole("button", { name: "Guardar cambio" }).click();
  await expect(row).toContainText("Impacto subestimado");
  await expect(deptChart).toHaveAccessibleName(/Supera a menudo [1-9]/);

  // Publish.
  await page.getByRole("button", { name: "Publicar calibración" }).click();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText(/publicad/i).first()).toBeVisible();

  // Sharing phase: HR shares every submitted review.
  await page.goto(cycleUrl);
  await moveTo(page, "Compartir resultados", 6);
  await page
    .getByRole("button", { name: "Compartir todas las evaluaciones enviadas" })
    .click();
  await expect(page.getByText(/Se comparti/)).toBeVisible();

  // The employee sees only the final value.
  await page.goto("/es/me");
  await actAs(page, employeeName, "Empleado");
  await page.goto(`${cycleUrl}/result`);
  await expect(page.getByTestId("final-rating")).toContainText(
    "3 · Supera a menudo",
  );
  await expect(page.getByText("Necesita desarrollo")).toHaveCount(0);
  await expect(page.getByText("Impacto subestimado")).toHaveCount(0);
});
