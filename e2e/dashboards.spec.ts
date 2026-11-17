import { expect, type Page, test } from "@playwright/test";
import {
  byId,
  company,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

// Runs after the historical import (project "insights" depends on
// "chromium", where e2e/historical-import.spec.ts imports the Employee
// Performance report): the dashboards read the imported cycles.
const cycleName = company.cycles[0].name;

const assessed = new Set(
  company.assessments
    .filter((a) => a.cycle === 0 && a.employeeId !== null)
    .map((a) => a.employeeId!),
);
const renamed = new Set(company.identity.renames.map((r) => r.employeeId));

// Someone assessed in the first imported cycle whose manager today is an
// active person with a unique name.
const employee = find(
  employees,
  (e) =>
    assessed.has(e.id) &&
    !renamed.has(e.id) &&
    isActive(e) &&
    hasUniqueName(e) &&
    e.managerId !== null &&
    byId.has(e.managerId) &&
    isActive(byId.get(e.managerId)!) &&
    hasUniqueName(byId.get(e.managerId)!),
  "assessed person with a current manager with a unique name",
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

test("dashboards of an imported cycle: progress, team as-of/current, trajectory and leadership view", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es/cycles");
  await page.getByRole("link", { name: cycleName }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  const cycleId = page.url().split("/").pop()!;

  // HR: progress counts of the cycle.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto(`/es/dashboards?cycle=${cycleId}`);
  const progress = page.getByRole("region", { name: "Avance del ciclo" });
  await expect(progress.getByText("Fase del ciclo: Cerrado")).toBeVisible();
  await expect(
    progress.getByRole("img", {
      name: /^Evaluación del manager: [1-9]\d* de \d+ enviadas$/,
    }),
  ).toBeVisible();
  const exportLink = progress.getByRole("link", { name: "Exportar CSV" });
  await expect(exportLink).toHaveAttribute(
    "href",
    new RegExp(`/api/v1/export/dashboard-progress\\.csv\\?cycle=${cycleId}`),
  );
  const csv = await page.request.get((await exportLink.getAttribute("href"))!);
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain("manager");

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

  // Manager: own team today, then a trajectory.
  await actAs(page, managerName, "Manager");
  await page.goto(`/es/dashboards/team?cycle=${cycleId}&hierarchy=current`);
  const team = page.getByTestId("team-table");
  await expect(team.getByRole("link", { name: employeeName })).toBeVisible();
  await team.getByRole("link", { name: employeeName }).click();
  await expect(
    page.getByRole("heading", { name: `Trayectoria de ${employeeName}` }),
  ).toBeVisible();
});

test("direction only reads the leadership view; managers without a person and employees get no dashboard", async ({
  page,
}) => {
  await page.goto("/es/cycles");
  await page.getByRole("link", { name: cycleName }).click();
  const cycleId = page.url().split("/").pop()!;

  const bar = page.getByRole("form", { name: "Actuar como" });
  await bar.getByLabel("Rol").selectOption({ label: "Dirección" });
  await expect(bar.getByLabel("Persona", { exact: true })).toBeDisabled();
  await bar.getByRole("button", { name: "Aplicar" }).click();
  await expect(bar.getByText("Actuando como: Dirección")).toBeVisible();

  // /dashboards sends direction to the aggregates; names never show up.
  await page.goto(`/es/dashboards?cycle=${cycleId}`);
  await expect(page).toHaveURL(/\/es\/dashboards\/executive/);
  await expect(
    page.getByRole("heading", { name: /^Vista de dirección/ }),
  ).toBeVisible();
  await expect(page.getByTestId("exec-participants")).toBeVisible();
  await expect(page.getByText(employeeName)).toHaveCount(0);
  // Individual views are closed to it.
  await page.goto(
    `/es/dashboards/team?cycle=${cycleId}&manager=00000000-0000-4000-8000-000000000000`,
  );
  await expect(
    page.getByText("No tenés acceso a estos dashboards."),
  ).toBeVisible();

  // An employee has no dashboard (and no executive view either).
  await bar.getByLabel("Rol").selectOption({ label: "Empleado" });
  await bar.getByRole("button", { name: "Aplicar" }).click();
  await expect(bar.getByText("Actuando como: Sin persona")).toBeVisible();
  await page.goto(`/es/dashboards/executive?cycle=${cycleId}`);
  await expect(
    page.getByText("No tenés acceso a estos dashboards."),
  ).toBeVisible();
});
