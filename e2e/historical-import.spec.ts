import path from "node:path";
import { expect, test } from "@playwright/test";
import { company, employees, fullName, hasUniqueName } from "./seed-data";

const REPORTS = path.resolve("fixtures/bamboo-reports/small");

const renamed = new Set(company.identity.renames.map((r) => r.employeeId));
const misspelled = new Set(
  company.identity.misspellings.map((m) => `${m.employeeId}:${m.cycle}`),
);
const seeded = new Map(employees.map((e) => [e.id, e]));

/** Someone whose 2023 assessment is in the report under their seeded name. */
const assessed2023 = company.assessments
  .filter(
    (a) =>
      a.cycle === 0 &&
      a.employeeId !== null &&
      a.selfStatus === "Submitted" &&
      a.managerStatus === "Submitted" &&
      !renamed.has(a.employeeId) &&
      !misspelled.has(`${a.employeeId}:0`),
  )
  .map((a) => seeded.get(a.employeeId!))
  .find((e) => e !== undefined && hasUniqueName(e))!;

test("importing the employee performance report creates the historical cycles and their participants", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/es/imports/upload");
  await page
    .getByLabel("Archivo", { exact: true })
    .setInputFiles(path.join(REPORTS, "employee-performance.csv"));
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

  const cycles = page.getByRole("table", { name: "Ciclos detectados" });
  await expect(cycles.getByRole("row")).toHaveCount(1 + company.cycles.length);
  for (const cycle of company.cycles) {
    await expect(cycles.getByRole("link", { name: cycle.name })).toBeVisible();
  }

  // The 2023 cycle lists a person assessed in it, with their as-of snapshot.
  await cycles.getByRole("link", { name: company.cycles[0].name }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  await expect(
    page
      .getByRole("table", { name: "Participantes" })
      .getByRole("row", { name: new RegExp(fullName(assessed2023)) }),
  ).toBeVisible();

  // People the HRIS does not know wait in the identity queue.
  await page.goto("/es/imports/identity");
  for (const outsider of company.identity.outsiders.filter(
    (o) => o.report === "employee-performance",
  )) {
    await expect(
      page.getByRole("link", { name: outsider.name }).first(),
    ).toBeVisible();
  }
});
