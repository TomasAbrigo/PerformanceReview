import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { importFile } from "./upload";
import { assessedFirstCycle, company, fullName } from "./seed-data";

const REPORTS = path.resolve("fixtures/bamboo-reports/small");
/** es.json ImportHistory.decision */
const decision = {
  title: "Hay filas esperando un ciclo",
  create: "Crear el ciclo {name} ({start} – {end})",
  submit: "Importar en ese ciclo",
  resolved: "Las filas en espera se importaron en el ciclo elegido.",
};

// Assessment Progress needs the cycles the performance report creates.
test.describe.configure({ mode: "serial" });

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

  const cycles = page.getByRole("group", { name: "Ciclos detectados" });
  await expect(cycles.getByRole("article")).toHaveCount(company.cycles.length);
  for (const cycle of company.cycles) {
    await expect(
      cycles.getByRole("heading", { name: cycle.name }),
    ).toBeVisible();
  }

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

test("importing the assessment progress report fills the completion of the semi-annual cycles", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await importFile(
    page,
    path.join(REPORTS, "assessment-progress.csv"),
    "bamboo-assessment-progress",
  );

  const cycles = page.getByRole("group", { name: "Ciclos detectados" });
  await expect(cycles.getByRole("article")).toHaveCount(company.cycles.length);
  await expect(page.getByRole("heading", { name: decision.title })).toHaveCount(
    0,
  );
});

test("a row whose semester is ambiguous waits for a cycle, and the run finishes once one is chosen", async ({
  page,
}) => {
  test.setTimeout(240_000);
  // No cycle name, and a date 4 days before a semester cutoff.
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-ambiguous-"));
  const file = path.join(dir, "employee-performance.csv");
  writeFileSync(
    file,
    [
      "Employee Name,Manager,Department,Review Cycle,Assessment Date,Employee Q3: What are some things I do well?",
      `${fullName(assessedFirstCycle)},,${assessedFirstCycle.department},,2023-12-28,Ok`,
    ].join("\n") + "\n",
  );
  await importFile(page, file, "bamboo-employee-performance");

  await expect(
    page.getByRole("heading", { name: decision.title }),
  ).toBeVisible();
  await page
    .getByRole("radio", {
      name: decision.create
        .replace("{name}", "2023-H2")
        .replace("{start}", "2023-07-01")
        .replace("{end}", "2023-12-31"),
    })
    .check();
  await page.getByRole("button", { name: decision.submit }).click();

  await expect(page.getByText(decision.resolved)).toBeVisible();
  await expect(page.getByRole("heading", { name: decision.title })).toHaveCount(
    0,
  );
  await expect(
    page
      .getByRole("group", { name: "Ciclos detectados" })
      .getByRole("heading", { name: "2023-H2" }),
  ).toBeVisible();
});

test("Bamboo's real reports: the raw assessments report and the grouped Assessment Progress import idempotently (#83)", async ({
  page,
}) => {
  test.setTimeout(480_000);
  const firstPeriod = "Evaluación semestral 2024-04-15 – 2024-09-28";
  for (const [file, profile] of [
    ["assessments-report.csv", "bamboo-assessments-report"],
    ["assessment-status.csv", "bamboo-assessment-status"],
    ["assessments-report.csv", "bamboo-assessments-report"],
  ] as const) {
    await importFile(page, path.join(REPORTS, file), profile);
    const cycles = page.getByRole("group", { name: "Ciclos detectados" });
    await expect(cycles.getByRole("article")).toHaveCount(
      company.cycles.length,
    );
    await expect(
      cycles.getByRole("heading", { name: firstPeriod }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: decision.title }),
    ).toHaveCount(0);
  }
});
