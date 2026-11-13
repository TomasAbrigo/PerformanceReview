import { expect, test } from "@playwright/test";

// The runs these specs look at are made once by e2e/global-setup.ts (through
// the CLI, the only way runs get created): the employee re-run, where
// everything is unchanged, and a run that failed on a broken fixture file.
const okRun = process.env.E2E_RUN_OK ?? "";
const failedRun = process.env.E2E_RUN_FAILED ?? "";

test.beforeAll(() => {
  expect(okRun, "E2E_RUN_OK is set by e2e/global-setup.ts").not.toBe("");
  expect(failedRun, "E2E_RUN_FAILED is set by e2e/global-setup.ts").not.toBe(
    "",
  );
});

const rowOf = (page: import("@playwright/test").Page, runId: string) =>
  page
    .getByRole("row")
    .filter({ has: page.locator(`a[href$="/imports/runs/${runId}"]`) });

test("the home page links to the runs log", async ({ page }) => {
  await page.goto("/es");
  await page.getByRole("link", { name: "Importaciones" }).click();

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
  // read, inserted, updated, unchanged, deleted, rejected, issues
  await expect(row.getByRole("cell").nth(5)).toHaveText("3");
  await expect(row.getByRole("cell").nth(8)).toHaveText("3");
  await expect(row.getByRole("cell").nth(11)).toHaveText("0");
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

  const counts = page.getByRole("table", { name: "Conteos" });
  for (const [label, value] of [
    ["Leídos", "3"],
    ["Insertados", "0"],
    ["Actualizados", "0"],
    ["Sin cambios", "3"],
    ["Eliminados", "0"],
    ["Rechazados", "0"],
  ]) {
    await expect(
      counts.getByRole("row", { name: `${label} ${value}`, exact: true }),
    ).toBeVisible();
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
    page
      .getByRole("table", { name: "Counts" })
      .getByRole("row", { name: "Read 3", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Back to runs" }).click();
  await expect(page).toHaveURL(/\/en\/imports\/runs$/);
});

// With Cache Components the shell is already a 200 when the request-time
// lookup fails, so notFound() renders the not-found UI instead of a 404 status
// (same as templates.spec.ts).
test("an unknown run renders not-found", async ({ page }) => {
  for (const id of ["not-a-uuid", "00000000-0000-4000-8000-000000000000"]) {
    await page.goto(`/es/imports/runs/${id}`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  }
});
