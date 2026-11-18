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
  await expect(
    page.getByRole("status").filter({ hasText: "Proveedor" }),
  ).toContainText("Proveedor: mock", { timeout: 60_000 });

  const bars = page.getByRole("group", {
    name: "Barras apiladas de sentimiento por dimensión",
  });
  await expect(bars).toBeVisible();
  await expect(bars.getByTestId("sentiment-bar").first()).toBeVisible();
  await expect(bars).toContainText("Fortalezas");

  // Every segment opens the comments behind it in the drill sheet.
  await bars.getByRole("link").first().click();
  await expect(page).toHaveURL(/drill=comments/);
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Comentarios");
  await page.goto(page.url().replace(/[?&]drill=[^&]*/, ""));

  const themes = page.getByRole("list", { name: "Temas más frecuentes" });
  await expect(themes.getByRole("listitem").first()).toBeVisible();

  const comments = page.getByRole("group", { name: "Comentarios etiquetados" });
  await expect(comments).toBeVisible();

  // Five sentiments: the legend, the KPIs and the sentiment filter.
  await expect(
    page
      .getByRole("list", { name: "Leyenda de sentimientos" })
      .first()
      .getByRole("listitem"),
  ).toHaveText(["Positivo", "Constructivo", "Neutral", "Mixto", "Negativo"]);
  await expect(
    page.getByTestId("qualitative-kpis").getByRole("region"),
  ).toHaveCount(6);
  await expect(
    page.getByRole("form", { name: "Filtros" }).getByLabel("Sentimiento"),
  ).toContainText("Mixto");

  // Todos / Propios / Manager applies to every block and to the CSV.
  const side = page.getByRole("navigation", { name: "Quién escribe" });
  await side.getByRole("link", { name: "Manager" }).click();
  await expect(page).toHaveURL(/side=manager/);
  await expect(comments.getByText("MANAGER").first()).toBeVisible();
  await expect(comments.getByText("PROPIO")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Exportar CSV" }),
  ).toHaveAttribute("href", /relationship=manager/);
  await side.getByRole("link", { name: "Propios" }).click();
  await expect(page).toHaveURL(/side=self/);
  await expect(comments.getByText("PROPIO").first()).toBeVisible();
  await expect(comments.getByText("MANAGER")).toHaveCount(0);
  await side.getByRole("link", { name: "Todos" }).click();
  await expect(page).not.toHaveURL(/side=/);
});
