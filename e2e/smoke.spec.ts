import { expect, test } from "@playwright/test";

test("home page renders in Spanish at /es", async ({ page }) => {
  await page.goto("/es");

  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(
    page.getByRole("heading", { level: 1, name: "Performance Review" }),
  ).toBeVisible();
  await expect(page.getByText("Evaluaciones de desempeño")).toBeVisible();
});
