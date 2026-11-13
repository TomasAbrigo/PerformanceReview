import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const parentOf = (page: import("@playwright/test").Page, name: string) =>
  page
    .getByRole("treeitem", { name, exact: true })
    .locator("xpath=ancestor::li[@role='treeitem'][1]");

test("org chart at two dates shows Bruno's manager change", async ({
  page,
}) => {
  await page.goto("/es/org?date=2022-06-01");
  await expect(
    page.getByRole("heading", { level: 1, name: "Organigrama" }),
  ).toBeVisible();
  await expect(parentOf(page, "Bruno Pérez")).toHaveAttribute(
    "aria-label",
    "Carla Romero",
  );

  await page.getByLabel("Fecha").fill("2025-01-01");
  await page.getByRole("button", { name: "Ver" }).click();
  await expect(page).toHaveURL(/date=2025-01-01/);
  await expect(parentOf(page, "Bruno Pérez")).toHaveAttribute(
    "aria-label",
    "Ana García",
  );
  // Carla left in 2024.
  await expect(
    page.getByRole("treeitem", { name: "Carla Romero", exact: true }),
  ).toHaveCount(0);
});

test("person detail shows the job history", async ({ page }) => {
  await page.goto("/en/org?date=2025-01-01");
  await page.getByRole("link", { name: "Bruno Pérez" }).click();
  const history = page.getByRole("table", { name: "Job history" });
  await expect(history.getByRole("row")).toHaveCount(3);
  await expect(history.getByText("Senior Developer")).toBeVisible();
  await expect(history.getByText("Current")).toBeVisible();
});
