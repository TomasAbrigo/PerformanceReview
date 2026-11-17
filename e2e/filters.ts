import { expect, type Page } from "@playwright/test";

/** Opens `route` and picks the cycle `cycleName` in its "Filtros" form. */
export async function chooseCycle(
  page: Page,
  route: string,
  cycleName: string,
) {
  await page.goto(route);
  const filters = page.getByRole("form", { name: "Filtros" });
  await filters
    .locator('select[name="cycle"]')
    .selectOption({ label: cycleName });
  await filters.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/cycle=[0-9a-f-]{36}/);
}
