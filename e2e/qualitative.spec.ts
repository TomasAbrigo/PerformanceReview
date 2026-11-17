import { expect, test } from "@playwright/test";
import { company } from "./seed-data";

// Runs after the historical import (project "insights" depends on
// "chromium", where e2e/historical-import.spec.ts imports the Employee
// Performance report): its open-text answers are what the Mock labels.
const cycleName = company.cycles[0].name;

test("People runs the Mock analysis on an imported cycle and sees sentiment and themes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/es/insights/qualitative");
  const filters = page.getByRole("form", { name: "Filtros" });
  await filters.getByLabel("Ciclo").selectOption({ label: cycleName });
  await filters.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/cycle=[0-9a-f-]{36}/);

  await page.getByRole("button", { name: "Correr análisis" }).click();
  await expect(page.getByRole("status")).toContainText("Proveedor: mock", {
    timeout: 60_000,
  });

  const bars = page.getByRole("img", {
    name: "Barras apiladas de sentimiento por dimensión",
  });
  await expect(bars).toBeVisible();
  await expect(bars.getByTestId("sentiment-bar").first()).toBeVisible();
  await expect(bars).toContainText("Fortalezas");

  const themes = page.getByRole("list", { name: "Temas más frecuentes" });
  await expect(themes.getByRole("listitem").first()).toBeVisible();

  await expect(
    page.getByRole("table", { name: "Comentarios etiquetados" }),
  ).toBeVisible();
});
