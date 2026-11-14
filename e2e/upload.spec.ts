import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const REPORTS = path.resolve("fixtures/bamboo-reports/small");

/** Data rows of a CSV: lines outside quotes (cells may span lines), minus the header. */
function csvRows(file: string): number {
  let lines = 0;
  let quoted = false;
  let lineHasContent = false;
  for (const char of readFileSync(file, "utf8")) {
    if (char === '"') quoted = !quoted;
    if (char === "\n" && !quoted) {
      if (lineHasContent) lines++;
      lineHasContent = false;
    } else if (char !== "\r") {
      lineHasContent = true;
    }
  }
  if (lineHasContent) lines++;
  return lines - 1;
}

const employeePerformance = path.join(REPORTS, "employee-performance.csv");
const total = csvRows(employeePerformance);

/** Upload the file in English, pick the profile, import and land on the run page. */
async function importEmployeePerformance(page: Page) {
  await page.goto("/en/imports/upload");
  await page
    .getByLabel("File", { exact: true })
    .setInputFiles(employeePerformance);
  await page.getByRole("button", { name: "Preview" }).click();
  await page
    .getByLabel("Source profile")
    .selectOption("bamboo-employee-performance");
  // Only land the rows (historical-import.spec.ts covers the cycles).
  await page.getByRole("checkbox", { name: "Only land the rows" }).check();
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page).toHaveURL(/\/en\/imports\/runs\/[0-9a-f-]{36}$/);
  return page.getByRole("table", { name: "Counts" });
}

test("uploads the employee performance report, previews it and imports it", async ({
  page,
}) => {
  await page.goto("/es/imports/upload");
  await expect(
    page.getByRole("heading", { level: 1, name: "Subir archivo" }),
  ).toBeVisible();
  await expect(
    page.getByText("Elegí un archivo para ver sus columnas"),
  ).toBeVisible();

  await page
    .getByLabel("Archivo", { exact: true })
    .setInputFiles(employeePerformance);
  await page.getByRole("button", { name: "Previsualizar" }).click();

  // Preview: detected columns, first 20 rows, and the profile that matches.
  await expect(
    page.getByRole("heading", { level: 2, name: "Vista previa" }),
  ).toBeVisible();
  await expect(page.getByLabel("Perfil de fuente")).toHaveValue(
    "bamboo-employee-performance",
  );
  await page
    .getByLabel("Perfil de fuente")
    .selectOption("bamboo-employee-performance");
  await expect(
    page.getByText("El archivo tiene todas las columnas que pide el perfil."),
  ).toBeVisible();
  const columns = page.getByRole("table", { name: "Columnas detectadas" });
  await expect(
    columns.getByRole("row", { name: /^Review Cycle/ }),
  ).toBeVisible();
  const rows = page.getByRole("table", { name: "Primeras filas" });
  await expect(rows.getByRole("row")).toHaveCount(1 + 20);

  await page.getByRole("checkbox", { name: "Solo aterrizar" }).check();
  await page.getByRole("button", { name: "Importar" }).click();

  // The run's page: the rows read are all the rows of the file.
  await expect(page).toHaveURL(/\/es\/imports\/runs\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Corrida de importación" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Conteos" })
      .getByRole("row", { name: `Leídos ${total}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/"profile": "bamboo-employee-performance"/),
  ).toBeVisible();
  await expect(
    page.getByText(/"fileName": "employee-performance.csv"/),
  ).toBeVisible();
});

test("importing the same file again creates no new records", async ({
  page,
}) => {
  await importEmployeePerformance(page); // new, or already there from another test

  const counts = await importEmployeePerformance(page);

  await expect(
    counts.getByRole("row", { name: `Read ${total}`, exact: true }),
  ).toBeVisible();
  await expect(
    counts.getByRole("row", { name: "Inserted 0", exact: true }),
  ).toBeVisible();
  await expect(
    counts.getByRole("row", { name: `Unchanged ${total}`, exact: true }),
  ).toBeVisible();
});

test("a file missing a column of the profile is flagged and cannot be imported", async ({
  page,
}) => {
  await page.goto("/en/imports/upload");

  // A goal status report is not an employee performance report.
  await page
    .getByLabel("File", { exact: true })
    .setInputFiles(path.join(REPORTS, "goal-status.csv"));
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Preview" }),
  ).toBeVisible();
  await page
    .getByLabel("Source profile")
    .selectOption("bamboo-employee-performance");

  // (Next's route announcer is an alert too.)
  const alert = page
    .getByRole("alert")
    .filter({ hasText: "does not match the profile" });
  await expect(alert).toContainText("Review Cycle");
  await expect(
    page
      .getByRole("table", { name: "Detected columns" })
      .locator('tr[data-issue="missing_column"]')
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Import" })).toBeDisabled();
});
