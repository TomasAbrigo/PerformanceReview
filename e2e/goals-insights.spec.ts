import { expect, type Page, test } from "@playwright/test";
import { actAs, actAsRole } from "./act-as";
import { goalSnapshotCount, participantOf } from "./goals-data";
import { assessed2023, company, fullName } from "./seed-data";

// Runs after the historical import (project "insights" depends on
// "chromium", where e2e/historical-import.spec.ts imports the Employee
// Performance report): the views read the imported cycles. Whether those
// cycles already have a goal snapshot depends on the import (it takes one per
// participant when it finishes): the specs assert what renders either way, and
// the figures only when goals are there.
const cycleName = company.cycles[0].name;
const personName = fullName(assessed2023);

/** Picks the cycle in the filters form and applies it. */
async function openGoals(page: Page, query = "") {
  await page.goto(`/es/insights/goals${query}`);
  await page.locator('select[name="cycle"]').selectOption({ label: cycleName });
  await page
    .getByRole("form", { name: "Filtros" })
    .getByRole("button", { name: "Aplicar" })
    .click();
  await expect(page).toHaveURL(/cycle=[0-9a-f-]{36}/);
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(cycleName) }),
  ).toBeVisible();
}

test("People see the goal KPIs, the indicators by completion, the outliers and the CSVs of an imported cycle", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");
  await openGoals(page);

  // Goal KPIs per area: a table with every group and a total.
  const kpis = page.getByRole("region", { name: "Indicadores de objetivos" });
  const table = kpis.getByTestId("kpis-table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", { name: /^Total/ })).toBeVisible();
  // At least the header, a group and the total.
  expect(await table.getByRole("row").count()).toBeGreaterThanOrEqual(3);

  // Grouping lives in the URL.
  await kpis.getByRole("link", { name: "Manager", exact: true }).click();
  await expect(page).toHaveURL(/groupBy=manager/);
  await expect(
    page
      .getByRole("region", { name: "Indicadores de objetivos" })
      .getByRole("link", { name: "Manager", exact: true }),
  ).toHaveAttribute("aria-current", "true");

  // Indicators by goals completion and the outliers render (counts >= 0).
  await expect(
    page.getByRole("region", {
      name: "Indicadores según el cumplimiento de objetivos",
    }),
  ).toBeVisible();
  const outliers = page.getByRole("region", { name: "Casos que no cuadran" });
  await expect(outliers.getByTestId("outliers-done-low-count")).toHaveText(
    /^(Ninguna persona|\d+ personas?)$/,
  );
  await expect(outliers.getByTestId("outliers-behind-high-count")).toHaveText(
    /^(Ninguna persona|\d+ personas?)$/,
  );

  // The people of the cycle, with their goals and indicators side by side.
  const people = page.getByTestId("people-table");
  await expect(people).toBeVisible();
  await expect(
    people.getByRole("link", { name: `Ver assessment de ${personName}` }),
  ).toBeVisible();

  // With goals in the snapshot the scatter and the buckets have numbers.
  if ((await goalSnapshotCount(cycleName)) > 0) {
    await expect(page.getByTestId("goals-scatter")).toBeVisible();
    await expect(table.getByRole("row", { name: /^Total/ })).toContainText(
      /\d+ \(\d+ %\)/,
    );
  }

  // The CSVs follow the filters; the headers are the file's language.
  const kpisCsv = await page.request.get(
    (await kpis
      .getByRole("link", { name: "Exportar CSV" })
      .getAttribute("href"))!,
  );
  expect(kpisCsv.ok()).toBe(true);
  expect(await kpisCsv.text()).toContain("grupo_id,grupo,personas");
  const outliersCsv = await page.request.get(
    (await outliers
      .getByRole("link", { name: "Exportar CSV" })
      .getAttribute("href"))!,
  );
  expect(outliersCsv.ok()).toBe(true);
  expect(await outliersCsv.text()).toContain("tipo,person_id,nombre");
  expect(await outliersCsv.text()).not.toContain("@");
});

test("the participant detail shows the answers and the goals of the period, to People and to the snapshot manager only", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { cycleId, participantId, managerName } = await participantOf(
    cycleName,
    personName,
  );
  const detail = `/es/cycles/${cycleId}/participants/${participantId}`;

  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");
  // From the cycle: the participant's row links to it.
  await page.goto(`/es/cycles/${cycleId}`);
  await page
    .getByRole("link", { name: `Ver el assessment de ${personName}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`${detail}$`));
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `${personName} · ${cycleName}`,
    }),
  ).toBeVisible();
  const answers = page.getByTestId("assessment-answers");
  await expect(
    answers.getByRole("article", { name: "Autoevaluación" }),
  ).toBeVisible();
  await expect(
    answers.getByRole("article", { name: "Evaluación del manager" }),
  ).toBeVisible();
  // The goals of the period sit on the same page (empty or not).
  await expect(
    page.getByRole("region", { name: "Objetivos del período" }),
  ).toBeVisible();

  // The manager of the snapshot reads it too; somebody else's manager and the
  // person themself do not.
  if (managerName) {
    await actAs(page, managerName, "Manager");
    await page.goto(detail);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `${personName} · ${cycleName}`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Evaluación del manager" }),
    ).toBeVisible();
  }
  await actAs(page, personName, "Empleado");
  await page.goto(detail);
  await expect(
    page.getByText("No tenés acceso a este assessment."),
  ).toBeVisible();
  await actAsRole(page, "Dirección", "Dirección");
  await page.goto(detail);
  await expect(
    page.getByText("No tenés acceso a este assessment."),
  ).toBeVisible();
});

test("direction only sees aggregates; employees are forbidden", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAsRole(page, "Dirección", "Dirección");
  await openGoals(page);
  await expect(
    page.getByText(/Solo agregados: los grupos de menos de \d+ personas/),
  ).toBeVisible();
  // Never a person: no scatter, no people table, no links to an assessment,
  // and the grouping by person is not even offered.
  await expect(page.getByTestId("people-table")).toHaveCount(0);
  await expect(page.getByTestId("goals-scatter")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /^Ver assessment de/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Persona", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(fullName(assessed2023))).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Exportar CSV" })).toHaveCount(0);

  await actAs(page, personName, "Empleado");
  await page.goto("/es/insights/goals");
  await expect(page.getByText("No tenés acceso a esta vista.")).toBeVisible();
  await expect(page.getByTestId("kpis-table")).toHaveCount(0);
});
