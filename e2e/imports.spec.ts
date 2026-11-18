import { expect, test, type Page } from "@playwright/test";
import { countValue as count, fact } from "./cards";
import { employees, queuedRecords, records } from "./seed-data";

// The runs these specs look at are made once by e2e/global-setup.ts (through
// the CLIs, the only way runs get created): the employee re-run of `pnpm
// db:seed`, where everything is unchanged, and a run that failed on a broken
// fixture file.
// The re-run reads every Bamboo record; what became a person is unchanged and
// the rehires are still held in the identity queue.
const READ = String(records.length);
const UNCHANGED = String(employees.length);
const QUEUED = String(queuedRecords.length);
const okRun = process.env.E2E_RUN_OK ?? "";
const failedRun = process.env.E2E_RUN_FAILED ?? "";

test.beforeAll(() => {
  expect(okRun, "E2E_RUN_OK is set by e2e/global-setup.ts").not.toBe("");
  expect(failedRun, "E2E_RUN_FAILED is set by e2e/global-setup.ts").not.toBe(
    "",
  );
});

/** The card of one run in the list. */
const rowOf = (page: Page, runId: string) =>
  page
    .getByRole("article")
    .filter({ has: page.locator(`a[href$="/imports/runs/${runId}"]`) });

test("the home page links to the runs log", async ({ page }) => {
  await page.goto("/es");
  await page
    .getByRole("navigation", { name: "Navegación" })
    .getByRole("link", { name: "Importaciones" })
    .click();

  await expect(page).toHaveURL(/\/es\/imports\/runs$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Corridas de importación" }),
  ).toBeVisible();
});

test("the list shows the run the CLI just made, with its counts", async ({
  page,
}) => {
  await page.goto("/es/imports/runs");

  const row = rowOf(page, okRun);
  await expect(row).toBeVisible();
  await expect(row).toContainText("bamboo_api");
  await expect(row).toContainText("fixture");
  await expect(row).toContainText("employee");
  await expect(row).toContainText("Exitosa");
  await expect(fact(row, "Leídos")).toHaveText(READ);
  await expect(fact(row, "Sin cambios")).toHaveText(UNCHANGED);
  await expect(fact(row, "En cola")).toHaveText(QUEUED);
});

test("a failed run is listed as failed and shows its error", async ({
  page,
}) => {
  await page.goto("/es/imports/runs?status=error");

  const row = rowOf(page, failedRun);
  await expect(row).toContainText("Con error");
  await expect(rowOf(page, okRun)).toHaveCount(0);

  await row.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/imports/runs/${failedRun}$`));
  // (Next's route announcer is a role=alert too: pick ours by its content.)
  const alert = page.getByRole("alert").filter({ hasText: /JSON/i });
  await expect(alert).toContainText("Error");
});

test("opening a run shows its exact counts and rejects", async ({ page }) => {
  await page.goto("/es/imports/runs");
  await rowOf(page, okRun).getByRole("link").click();

  await expect(page).toHaveURL(new RegExp(`/es/imports/runs/${okRun}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: "Corrida de importación" }),
  ).toBeVisible();
  await expect(page.getByText(okRun)).toBeVisible();

  const counts = page.getByRole("group", { name: "Conteos" });
  for (const [label, value] of [
    ["Leídos", READ],
    ["Insertados", "0"],
    ["Actualizados", "0"],
    ["Sin cambios", UNCHANGED],
    ["Eliminados", "0"],
    ["Rechazados", "0"],
  ]) {
    await expect(count(counts, label)).toHaveText(value);
  }
  await expect(
    page.getByText("Esta corrida no tuvo rechazos ni incidencias."),
  ).toBeVisible();
  await expect(page.getByText(/"source": "fixture"/)).toBeVisible();
});

test("the detail is available in English too", async ({ page }) => {
  await page.goto(`/en/imports/runs/${okRun}`);

  await expect(
    page.getByRole("heading", { level: 1, name: "Import run" }),
  ).toBeVisible();
  await expect(
    count(page.getByRole("group", { name: "Counts" }), "Read"),
  ).toHaveText(READ);
  await page.getByRole("link", { name: "← Back to runs" }).click();
  await expect(page).toHaveURL(/\/en\/imports\/runs$/);
});

// With Cache Components the shell is already a 200 when the request-time
// lookup fails, so notFound() renders the not-found UI instead of a 404 status
// (same as templates.spec.ts).
test("an unknown run renders not-found", async ({ page }) => {
  for (const id of ["not-a-uuid", "00000000-0000-4000-8000-000000000000"]) {
    await page.goto(`/es/imports/runs/${id}`);
    await expect(page.getByText("No encontramos esta página.")).toBeVisible();
  }
});
