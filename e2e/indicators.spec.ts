import { expect, type Page, test } from "@playwright/test";
import { actAs } from "./act-as";
import { snapshotManagerWithIndicators } from "./indicator-data";
import { assessed2023, company, fullName } from "./seed-data";

// Runs after the historical import (project "insights" depends on
// "chromium", where e2e/historical-import.spec.ts imports the Employee
// Performance report): the indicators read the imported cycles.
const cycleName = company.cycles[0].name;
const employeeName = fullName(assessed2023);

/** Submits the filters form (the header's "Actuar como" has its own Aplicar). */
const applyFilters = (page: Page) =>
  page
    .getByRole("form", { name: "Filtros" })
    .getByRole("button", { name: "Aplicar" })
    .click();

test("People see the distribution, the risk matrix and the alerts of an imported cycle", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");
  await page.goto("/es/insights/indicators");
  await page.locator('select[name="cycle"]').selectOption({ label: cycleName });
  await applyFilters(page);
  await expect(page).toHaveURL(/cycle=[0-9a-f-]{36}/);
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(cycleName) }),
  ).toBeVisible();

  // Distribution of retention by area: a histogram per group and the total.
  const distribution = page.getByRole("region", {
    name: "Distribución de Retención",
  });
  await expect(
    distribution.getByTestId("indicator-histogram").first(),
  ).toBeVisible();
  expect(
    await distribution.getByTestId("indicator-histogram").count(),
  ).toBeGreaterThan(1);
  await expect(
    distribution.getByRole("img", { name: /^Todos: valor 1: \d+, valor 2/ }),
  ).toBeVisible();

  // The same for engagement.
  await page.locator('select[name="indicator"]').selectOption("engagement");
  await applyFilters(page);
  const engagement = page.getByRole("region", {
    name: "Distribución de Compromiso",
  });
  await expect(engagement).toBeVisible();

  // The matrix counts the people who have both indicators.
  const matrix = page.getByRole("region", {
    name: "Matriz de retención y compromiso",
  });
  await expect(matrix.getByTestId("matrix-summary")).toContainText(
    /[1-9]\d* personas? con ambos indicadores/,
  );
  await expect(
    matrix.getByRole("img", { name: /^Matriz de retención y compromiso: / }),
  ).toBeVisible();
  await expect(matrix.getByTestId("risk-list")).toBeVisible();

  // Alerts, with the summary of falls and risks.
  const alerts = page.getByRole("region", { name: "Alertas" });
  await expect(alerts.getByTestId("alerts-summary")).toContainText(
    /Personas con caída: \d+ · Personas en riesgo: \d+/,
  );

  // The CSV exports follow the filters.
  const exportLink = engagement.getByRole("link", { name: "Exportar CSV" });
  await expect(exportLink).toHaveAttribute(
    "href",
    /\/api\/v1\/export\/insights-indicator-distribution\.csv\?cycle=[0-9a-f-]{36}&indicator=engagement/,
  );
  const csv = await page.request.get((await exportLink.getAttribute("href"))!);
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain("grupo,indicador,valor,cantidad");
  const alertsCsv = await page.request.get(
    (await alerts
      .getByRole("link", { name: "Exportar CSV" })
      .getAttribute("href"))!,
  );
  expect(alertsCsv.ok()).toBe(true);
  expect(await alertsCsv.text()).toContain("alerta,indicador,person_id");

  // The evolution page draws both indicators.
  await page.goto("/es/insights/indicators/trend");
  await expect(
    page.getByRole("region", {
      name: "Retención: toda la organización",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: /^Compromiso por ciclo, toda la organización: /,
    }),
  ).toBeVisible();
});

test("a manager sees only their direct reports; an employee is forbidden", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // An employee never sees these values, not even their own.
  await page.goto("/es");
  await actAs(page, employeeName, "Empleado");
  await page.goto("/es/insights/indicators");
  await expect(
    page.getByText("No tenés acceso a estos indicadores."),
  ).toBeVisible();
  await expect(page.getByTestId("indicator-histogram")).toHaveCount(0);
  await page.goto("/es/insights/indicators/trend");
  await expect(
    page.getByText("No tenés acceso a estos indicadores."),
  ).toBeVisible();

  const manager = await snapshotManagerWithIndicators(cycleName);
  await actAs(page, manager.name, "Manager");
  await page.goto("/es/insights/indicators");
  await page.locator('select[name="cycle"]').selectOption({ label: cycleName });
  await applyFilters(page);
  await expect(
    page.getByText(
      "Ves solo a tus reportes directos al momento de cada ciclo.",
    ),
  ).toBeVisible();
  const distribution = page.getByRole("region", {
    name: "Distribución de Retención",
  });
  await expect(
    distribution.getByTestId("indicator-histogram").first(),
  ).toBeVisible();
  // The only manager in the picker is themself.
  await expect(
    page.locator('select[name="manager"]').locator("option"),
  ).toHaveText(["Todos", manager.name]);
  // The list of people at risk is for People only.
  await expect(page.getByTestId("risk-list")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Exportar CSV" })).toHaveCount(0);
});
