import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

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

  await page.getByRole("button", { name: "Importar" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "Importación terminada" }),
  ).toBeVisible();
  await expect(page.locator('[data-count="read"] dd')).toHaveText(
    String(csvRows(employeePerformance)),
  );
  await expect(
    page.getByRole("link", { name: "Ver la corrida" }),
  ).toHaveAttribute("href", /\/es\/imports\/runs\/[0-9a-f-]{36}$/);
});

test("importing the same file again creates no new records", async ({
  page,
}) => {
  const total = String(csvRows(employeePerformance));
  await page.goto("/en/imports/upload");

  async function importOnce() {
    await page
      .getByLabel("File", { exact: true })
      .setInputFiles(employeePerformance);
    await page.getByRole("button", { name: "Preview" }).click();
    await page
      .getByLabel("Source profile")
      .selectOption("bamboo-employee-performance");
    await page.getByRole("button", { name: "Import" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "Import finished" }),
    ).toBeVisible();
    await expect(page.locator('[data-count="read"] dd')).toHaveText(total);
  }

  await importOnce(); // new, or already there from another test
  await page.getByRole("button", { name: "Upload another file" }).click();
  await importOnce();

  await expect(page.locator('[data-count="inserted"] dd')).toHaveText("0");
  await expect(page.locator('[data-count="unchanged"] dd')).toHaveText(total);
  await expect(
    page.getByText(
      "No new records were created: this file had already been imported.",
    ),
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
  await expect(alert).toContainText("The file does not match the profile");
  await expect(alert).toContainText("Review Cycle");
  await expect(
    page
      .getByRole("table", { name: "Detected columns" })
      .locator('tr[data-issue="missing_column"]')
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Import" })).toBeDisabled();
});
