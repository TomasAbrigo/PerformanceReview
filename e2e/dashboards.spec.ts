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

// An employee with no reports whose manager (at the snapshot and today) is
// an active person with a unique name.
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

async function launchCycle(page: Page, name: string) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill(company.asOf);
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page
    .getByLabel("Plantilla")
    .selectOption({ label: "Evaluación de fin de año" });
  await page.getByRole("button", { name: "Siguiente" }).click();
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
  return page.url().split("/").pop()!;
}

async function submitManagerReview(page: Page, cycleName: string) {
  await page.goto("/es/team");
  await page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: cycleName })
    .filter({ hasText: employeeName })
    .getByRole("link", { name: "Evaluar" })
    .click();
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
  await expect(page.getByText("Borrador guardado")).toBeVisible();
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(page.getByText(/Enviado el/)).toBeVisible();
}

test("dashboards: progress, distribution, team as-of/current, trajectory and leadership view", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const name = `Dashboards e2e ${Date.now()}`;
  await page.goto("/es");
  const cycleId = await launchCycle(page, name);

  await actAs(page, managerName, "Manager");
  await submitManagerReview(page, name);

  // HR: progress counts and the distribution of the cycle.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto(`/es/dashboards?cycle=${cycleId}`);
  const progress = page.getByRole("region", { name: "Avance del ciclo" });
  await expect(progress.getByText("Fase del ciclo: collecting")).toBeVisible();
  await expect(
    progress.getByRole("img", {
      name: /^Evaluación del manager: [1-9]\d* de \d+ enviadas$/,
    }),
  ).toBeVisible();
  const dist = page.getByRole("region", { name: "Distribución de ratings" });
  await expect(dist.getByTestId("histogram").first()).toBeVisible();

  // The hierarchy toggle lives in the URL.
  await page.getByRole("link", { name: "Actual", exact: true }).click();
  await expect(page).toHaveURL(/hierarchy=current/);
  await expect(
    page.getByRole("link", { name: "Actual", exact: true }),
  ).toHaveAttribute("aria-current", "true");

  // Leadership view: aggregates, no names.
  await page.goto(`/es/dashboards/executive?cycle=${cycleId}`);
  await expect(page.getByTestId("exec-participants")).not.toHaveText("0");
  await expect(page.getByText(employeeName)).toHaveCount(0);
  await expect(page.getByText(managerName)).toHaveCount(0);

  // Manager: own team as of the review and now, then a trajectory.
  await actAs(page, managerName, "Manager");
  await page.goto(`/es/dashboards/team?cycle=${cycleId}`);
  const team = page.getByTestId("team-table");
  await expect(team.getByRole("link", { name: employeeName })).toBeVisible();
  await page.getByRole("link", { name: "Actual", exact: true }).click();
  await expect(page).toHaveURL(/hierarchy=current/);
  await expect(team.getByRole("link", { name: employeeName })).toBeVisible();
  await team.getByRole("link", { name: employeeName }).click();
  await expect(
    page.getByRole("heading", { name: `Trayectoria de ${employeeName}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: new RegExp(`${name}: \\d+ %`) }),
  ).toBeVisible();
});
