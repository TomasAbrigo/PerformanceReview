import { expect, test } from "@playwright/test";
import { company } from "./seed-data";

// Runs after the historical import (project "insights" depends on
// "chromium", where e2e/historical-import.spec.ts imports the Employee
// Performance report): its open-text answers are what the Mock labels.
const cycleName = company.cycles[0].name;

test("People runs the Mock analysis on an imported cycle and reads it per person", async ({
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

  // Who read it: the mock says it is a demo heuristic.
  await expect(page.getByTestId("reading-provenance")).toContainText(
    "Lectura de demostración (heurística de palabras clave)",
  );
  // Substance per question and side, in people; every segment opens its answers.
  const substance = page.getByTestId("substance-bar");
  await expect(substance.first()).toBeVisible();
  await expect(page.getByTestId("substance")).toContainText("Fortalezas");
  await substance.first().getByRole("link").first().click();
  await expect(page).toHaveURL(/drill=comments/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goto(page.url().replace(/[?&]drill=[^&]*/, ""));

  // Themes of each question, self and manager side by side; signals; yes/no.
  await expect(
    page.getByTestId("themes-strengths-list").getByRole("listitem").first(),
  ).toBeVisible();
  await expect(page.getByTestId("signals")).toBeVisible();
  await expect(page.getByTestId("yes-no")).toBeVisible();
  await expect(page.getByTestId("tone")).toBeVisible();
  const comments = page.getByRole("group", { name: "Comentarios etiquetados" });
  await expect(comments).toBeVisible();
  await expect(
    page.getByTestId("qualitative-kpis").getByRole("region"),
  ).toHaveCount(3);

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
