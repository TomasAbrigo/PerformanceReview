import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { actAs, actAsRole } from "./act-as";
import { chooseCycle } from "./filters";
import { importFile } from "./upload";
import { byId, company, fullName, hasUniqueName, isActive } from "./seed-data";

// Runs after the historical import (project "insights" depends on
// "chromium", where e2e/historical-import.spec.ts imports the Employee
// Performance and the Assessment Progress reports of the small fixtures): the
// completion view reads the imported cycles. The first test uploads the
// Assessment Progress file again, as People would on the next export: the same
// file changes nothing, so the numbers below stay those of the first import.
const REPORTS = path.resolve("fixtures/bamboo-reports/small");

// The second semester of 2024 has the most people still missing something,
// and a cycle before it to compare with.
const cycleIndex = 1;
const cycleName = company.cycles[cycleIndex].name;
const previousName = company.cycles[cycleIndex - 1].name;

const STATUS_ES = {
  "Not Started": "No iniciada",
  "In Progress": "En curso",
  Submitted: "Enviada",
} as const;

const renamed = new Set(company.identity.renames.map((r) => r.employeeId));

// People of that cycle who still miss a side, that the report names
// unambiguously, and whose manager (when the window closed) is a person with
// a unique name too.
const missing = company.assessments
  .filter(
    (a) =>
      a.cycle === cycleIndex &&
      a.employeeId !== null &&
      byId.has(a.employeeId) &&
      !renamed.has(a.employeeId) &&
      hasUniqueName(byId.get(a.employeeId)!) &&
      (a.selfStatus !== "Submitted" || a.managerStatus !== "Submitted"),
  )
  .map((a) => ({
    ...a,
    person: byId.get(a.employeeId!)!,
    manager: a.managerIdAtReview ? byId.get(a.managerIdAtReview) : undefined,
  }));

// A manager with someone missing, and a person missing in another team.
const withManager = missing.filter(
  (m) => m.manager && hasUniqueName(m.manager) && isActive(m.manager),
);
const teamId = Object.entries(
  Object.groupBy(withManager, (m) => m.managerIdAtReview!),
).sort(([, a], [, b]) => b!.length - a!.length)[0][0];
const team = withManager.filter((m) => m.managerIdAtReview === teamId);
const manager = byId.get(teamId)!;
const outsider = missing.find((m) => m.managerIdAtReview !== teamId)!;

/** The cycle chosen in the filters form. */
async function openCycle(page: Page) {
  await chooseCycle(page, "/es/insights/completion", cycleName);
  await expect(
    page.getByRole("heading", { name: new RegExp(`· ${cycleName}$`) }),
  ).toBeVisible();
}

const missingTable = (page: Page) =>
  page.getByRole("table", { name: "Quién falta" });

/** The row of a person (named by its header cell: a manager's name also shows in the rows of their team). */
const rowOf = (page: Page, name: string) =>
  missingTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name, exact: true }) });

test("People import the assessment progress and read the completion of a cycle", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await importFile(
    page,
    path.join(REPORTS, "assessment-progress.csv"),
    "bamboo-assessment-progress",
  );

  // Home links to the view, which opens on the latest cycle.
  await page.goto("/es");
  await page.getByRole("link", { name: "Completitud" }).click();
  await expect(page).toHaveURL(/\/es\/insights\/completion$/);
  await expect(
    page.getByRole("heading", { name: /^Completitud de evaluaciones · / }),
  ).toBeVisible();

  await openCycle(page);
  const summary = page.getByRole("region", { name: "Avance" });
  const groups = summary.getByTestId("completion-group");
  // The whole cycle first, then the areas of the snapshot.
  expect(await groups.count()).toBeGreaterThan(2);
  await expect(
    summary.getByRole("img", {
      name: /^Autoevaluación, Total del ciclo: [1-9]\d* de [1-9]\d* enviadas$/,
    }),
  ).toBeVisible();
  await expect(
    summary.getByRole("img", {
      name: /^Evaluación del manager, Total del ciclo: [1-9]\d* de [1-9]\d* enviadas$/,
    }),
  ).toBeVisible();
  // Assessment Progress is the source for everybody in the cycle.
  await expect(
    summary.getByText(/Assessment Progress para [1-9]\d* participantes/),
  ).toBeVisible();

  // The change since the previous semester, per group.
  // The previous cycle by period: the legacy one, or a real-report cycle
  // (#83) when historical-import ran first in the shared database.
  await expect(summary.getByTestId("delta-hint")).toHaveText(
    new RegExp(
      `^Comparación con (${previousName}|Evaluación semestral \\d{4}-\\d{2}-\\d{2} – \\d{4}-\\d{2}-\\d{2})$`,
    ),
  );
  expect(await summary.getByTestId("delta").count()).toBeGreaterThan(0);

  // Who is missing: everybody the report says has not submitted a side.
  const table = missingTable(page);
  for (const m of missing) {
    const row = rowOf(page, fullName(m.person));
    await expect(row).toBeVisible();
    // Columns: person, area, manager, self status, manager status, notes.
    await expect(row.locator("td:nth-child(4)")).toContainText(
      STATUS_ES[m.selfStatus],
    );
    await expect(row.locator("td:nth-child(5)")).toContainText(
      STATUS_ES[m.managerStatus],
    );
  }
  // The rows are the number the page announces, and there is no email.
  const rows = await table.getByRole("row").count();
  await expect(
    page.getByRole("status").filter({ hasText: /Falta/ }),
  ).toContainText(`${rows - 1} persona`);
  await expect(page.getByText("@")).toHaveCount(0);

  // The side that is missing narrows the list.
  await page
    .getByRole("link", { name: "Autoevaluación", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/status=self_missing/);
  const selfMissing = missing.filter((m) => m.selfStatus !== "Submitted");
  const selfOnly = missing.find((m) => m.selfStatus === "Submitted");
  await expect(rowOf(page, fullName(selfMissing[0].person))).toBeVisible();
  if (selfOnly) {
    await expect(rowOf(page, fullName(selfOnly.person))).toHaveCount(0);
  }

  // CSV: the list without email unless asked for.
  const links = page.getByRole("region", { name: "Quién falta" });
  const csv = await page.request.get(
    (await links
      .getByRole("link", { name: "Exportar CSV", exact: true })
      .getAttribute("href"))!,
  );
  expect(csv.ok()).toBe(true);
  const text = await csv.text();
  expect(text).toContain(fullName(selfMissing[0].person));
  expect(text.split("\r\n")[0]).not.toContain("email");
  const withEmail = await page.request.get(
    (await links
      .getByRole("link", { name: "Exportar CSV con email" })
      .getAttribute("href"))!,
  );
  expect((await withEmail.text()).split("\r\n")[0]).toContain("email");

  const summaryCsv = await page.request.get(
    (await summary
      .getByRole("link", { name: "Exportar CSV", exact: true })
      .getAttribute("href"))!,
  );
  expect(summaryCsv.ok()).toBe(true);
  expect(await summaryCsv.text()).toContain(cycleName);
});

test("a manager only sees their direct reports", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAs(page, fullName(manager), "Manager");
  await openCycle(page);

  await expect(
    page.getByText("Solo tus reportes directos.", { exact: false }),
  ).toBeVisible();
  const table = missingTable(page);
  for (const m of team) {
    await expect(rowOf(page, fullName(m.person))).toBeVisible();
  }
  // Somebody missing in another team is not theirs to see.
  await expect(rowOf(page, fullName(outsider.person))).toHaveCount(0);
  // Every row has them as the manager, and no CSV for managers.
  const managerCells = table.locator("tbody tr td:nth-child(3)");
  const names = await managerCells.allTextContents();
  expect(names.length).toBeGreaterThanOrEqual(team.length);
  expect(new Set(names)).toEqual(new Set([fullName(manager)]));
  await expect(page.getByRole("link", { name: /Exportar CSV/ })).toHaveCount(0);
});

test("direction reads aggregates only; employees have no access", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es");
  await actAsRole(page, "Dirección", "Dirección");
  await openCycle(page);
  await expect(page.getByTestId("completion-group").first()).toBeVisible();
  // No names, no managers and no list of people.
  await expect(page.getByText(fullName(outsider.person))).toHaveCount(0);
  await expect(missingTable(page)).toHaveCount(0);
  await expect(
    page.getByText("Dirección solo ve agregados", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Filtros" }).getByLabel("Manager"),
  ).toHaveCount(0);

  await actAsRole(page, "Empleado", "Sin persona");
  await page.goto("/es/insights/completion");
  await expect(
    page.getByText("No tenés acceso a esta pantalla."),
  ).toBeVisible();
  await expect(page.getByTestId("completion-group")).toHaveCount(0);
});
