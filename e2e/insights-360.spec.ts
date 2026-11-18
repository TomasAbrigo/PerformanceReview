import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { actAs, actAsRole } from "./act-as";
import { chooseCycle } from "./filters";
import { dmWithReports, managerWhoIsNoDm, peoplePerDm } from "./org-data";
import { assessedFirstCycle, company, fullName } from "./seed-data";

// Runs after the historical import (project "insights" depends on
// "chromium", where e2e/historical-import.spec.ts imports the reports that
// create the cycles). People load their org attributes file (account,
// project, DM, Santex Lead per person: fixtures/org/small) and every insights
// view can then be cut by it: the first test does the import, the rest read.
const cycleName = company.cycles[1].name;
const FILE = path.resolve("fixtures/org/small/org-attributes.csv");

test.describe.configure({ mode: "serial" });

/** Uploads the org attributes file as People would and waits for the run's page. */
async function importOrgAttributes(page: Page) {
  await page.goto("/es/imports/upload");
  await page.getByLabel("Archivo", { exact: true }).setInputFiles(FILE);
  await page.getByRole("button", { name: "Previsualizar" }).click();
  await expect(page.getByLabel("Perfil de fuente")).toHaveValue(
    "org-attributes",
  );
  await page.getByRole("button", { name: "Importar" }).click();
  await expect(page).toHaveURL(/\/es\/imports\/runs\/[0-9a-f-]{36}$/, {
    timeout: 120_000,
  });
}

test("People import the org attributes file once: the same file again changes nothing", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");

  await importOrgAttributes(page);
  const counts = page.getByRole("table", { name: "Conteos" });
  await expect(page.getByText("org_attribute").first()).toBeVisible();
  // Every row of the file is new (the number of attributes is not the point).
  await expect(counts.getByRole("row", { name: /^Insertados/ })).toHaveText(
    /^Insertados[1-9]\d*$/,
  );

  await importOrgAttributes(page);
  await expect(counts.getByRole("row", { name: /^Insertados/ })).toHaveText(
    "Insertados0",
  );
  await expect(counts.getByRole("row", { name: /^Actualizados/ })).toHaveText(
    "Actualizados0",
  );
});

test("People read one card per DM with the people under them, and the whole tree adds the chart below", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");
  const perDm = await peoplePerDm(cycleName);
  expect(perDm.size).toBeGreaterThan(0);

  await chooseCycle(page, "/es/insights/360", cycleName);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Análisis 360 · ${cycleName}`,
    }),
  ).toBeVisible();
  const cards = page.getByTestId("dm-card");
  await expect(cards).toHaveCount(perDm.size);
  const direct = new Map<string, number>();
  for (const [dm, people] of perDm) {
    const card = cards.filter({
      has: page.getByRole("heading", { level: 2, name: dm, exact: true }),
    });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("dm-card-people")).toHaveText(
      people === 1 ? "1 persona" : `${people} personas`,
    );
    // Every card has its means, its sparkline and a sentence by the rules.
    await expect(card.getByTestId("dm-retention")).toBeVisible();
    await expect(card.getByTestId("dm-sparkline")).toBeVisible();
    await expect(card.getByTestId("dm-insights").locator("li")).not.toHaveCount(
      0,
    );
    direct.set(dm, people);
  }

  // "Todo el árbol": nobody drops out of a card, and the cards say what they count.
  await page.getByLabel("Alcance").selectOption({ label: "Todo el árbol" });
  await page
    .getByRole("form", { name: "Filtros" })
    .getByRole("button", { name: "Aplicar" })
    .click();
  await expect(page).toHaveURL(/scope=tree/);
  await expect(page.getByText(/debajo del DM en el organigrama/)).toBeVisible();
  for (const [dm, people] of direct) {
    const card = page.getByTestId("dm-card").filter({
      has: page.getByRole("heading", { level: 2, name: dm, exact: true }),
    });
    const text = (await card.getByTestId("dm-card-people").textContent()) ?? "";
    expect(Number(/\d+/.exec(text)?.[0])).toBeGreaterThanOrEqual(people);
  }
});

test("the org cuts filter and group the completion view", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");
  await chooseCycle(page, "/es/insights/completion", cycleName);

  const groupBy = page.getByRole("group", { name: "Agrupar por" });
  await groupBy.getByRole("link", { name: "Cuenta", exact: true }).click();
  await expect(page).toHaveURL(/groupBy=account/);
  const summary = page.getByTestId("completion-summary");
  await expect(summary).toContainText("Cuenta A");
  await expect(summary).toContainText("Cuenta B");

  // Narrowing to one account leaves only its group.
  const filters = page.getByRole("form", { name: "Filtros" });
  await filters.locator('select[name="account"]').selectOption("Cuenta A");
  await filters.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/account=Cuenta\+A|account=Cuenta%20A/);
  await expect(summary).toContainText("Cuenta A");
  await expect(summary).not.toContainText("Cuenta B");
});

test("direction reads the DMs as numbered teams, never by name", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const perDm = await peoplePerDm(cycleName);
  await page.goto("/es");
  await actAsRole(page, "Dirección", "Dirección");
  await chooseCycle(page, "/es/insights/360", cycleName);

  await expect(
    page.getByText(/Solo agregados: DM con al menos 5/),
  ).toBeVisible();
  const cards = page.getByTestId("dm-card");
  await expect(cards.first()).toBeVisible();
  const body = (await page.locator("main").textContent()) ?? "";
  for (const dm of perDm.keys()) expect(body).not.toContain(dm);
  await expect(
    page.getByRole("heading", { level: 2, name: /^Equipo \d+$/ }).first(),
  ).toBeVisible();
  // The scope and the people left out are not for direction to read about.
  await expect(page.getByTestId("dm-without")).toHaveCount(0);
});

test("a manager who is a DM reads only their own card; one who is not has none", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const dm = await dmWithReports(cycleName);
  await page.goto("/es");
  await actAs(page, dm.name, "Manager");
  await chooseCycle(page, "/es/insights/360", cycleName);

  await expect(page.getByText("Tu tarjeta como DM")).toBeVisible();
  await expect(page.getByTestId("dm-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { level: 2, name: dm.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("dm-card-people")).toHaveText(
    dm.people === 1 ? "1 persona" : `${dm.people} personas`,
  );
  await expect(page.getByLabel("Alcance")).toHaveCount(0);

  const other = await managerWhoIsNoDm(cycleName);
  await actAs(page, other, "Manager");
  await chooseCycle(page, "/es/insights/360", cycleName);
  await expect(page.getByTestId("dm-card")).toHaveCount(0);
  await expect(page.getByText(/No figurás como DM/)).toBeVisible();
});

test("an employee has no access to the 360 analysis", async ({ page }) => {
  await page.goto("/es");
  await actAs(page, fullName(assessedFirstCycle), "Empleado");
  await page.goto("/es/insights/360");
  await expect(page.getByTestId("no-access")).toContainText(
    "No tenés acceso al Análisis 360.",
  );
  await expect(page.getByTestId("dm-card")).toHaveCount(0);
});
