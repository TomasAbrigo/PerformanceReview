import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const REPORTS = path.resolve("fixtures/bamboo-reports/small");

// Both tests import into the same cycles: one at a time.
test.describe.configure({ mode: "serial" });
const CYCLES = [
  "Evaluación de desempeño 2023",
  "Evaluación de desempeño 2024",
  "Evaluación de desempeño 2025",
];

/** Uploads a report with its built-in profile in domain mode (the default). */
async function importHistory(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
) {
  await page.goto("/es/imports/upload");
  await page.getByLabel("Archivo", { exact: true }).setInputFiles(file);
  await page.getByRole("button", { name: "Previsualizar" }).click();
  await expect(page.getByLabel("Perfil de fuente")).toHaveValue(
    "bamboo-employee-performance",
  );
  await expect(
    page.getByRole("checkbox", { name: "Solo aterrizar" }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Importar" }).click();
  await expect(page).toHaveURL(/\/es\/imports\/history\/[0-9a-f-]{36}$/, {
    timeout: 150_000,
  });
  await expect(
    page.getByRole("heading", { level: 1, name: "Importación histórica" }),
  ).toBeVisible();
  return page.getByRole("table", { name: "Ciclos detectados" });
}

test("importing the employee performance report creates the 3 historical cycles", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const cycles = await importHistory(
    page,
    path.join(REPORTS, "employee-performance.csv"),
  );

  // One row per detected cycle (plus the header).
  await expect(cycles.getByRole("row")).toHaveCount(1 + CYCLES.length);
  for (const name of CYCLES) {
    await expect(cycles.getByRole("link", { name })).toBeVisible();
  }

  // People the HRIS does not know wait in the identity queue.
  await page.getByRole("link", { name: "Ver la cola de identidad" }).click();
  await expect(page).toHaveURL(/\/es\/imports\/identity$/);
  for (const outsider of [
    "Bruno Salvatierra",
    "Eliana Corvalán",
    "Ulises Mansilla",
  ]) {
    await expect(
      page.getByRole("link", { name: outsider }).first(),
    ).toBeVisible();
  }
});

test("an imported assessment shows its participant in the historical cycle", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Bruno Pérez is in the seeded HRIS (src/modules/bamboo-client/__fixtures__).
  const csv = [
    "Employee Name,Manager,Department,Review Cycle,Assessment Date,Employee Q3: What are some things I do well?,Manager Q3: What are some things [Employee] does well?",
    "Bruno Pérez,Ana García,Ingeniería,Evaluación de desempeño 2023,2023-12-05,Cumplo con lo que prometo.,Es confiable.",
  ].join("\n");
  const cycles = await importHistory(page, {
    name: "employee-performance.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`${csv}\n`),
  });

  await cycles
    .getByRole("link", { name: "Evaluación de desempeño 2023" })
    .click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  await expect(
    page
      .getByRole("table", { name: "Participantes" })
      .getByRole("row", { name: /Bruno Pérez/ }),
  ).toBeVisible();
});
