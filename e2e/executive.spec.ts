import { expect, test } from "@playwright/test";
import { actAs, actAsRole } from "./act-as";
import { company } from "./seed-data";

// Runs in the "insights" project, after the historical import (chromium).
const cycleName = company.cycles[0].name;

test("People see the executive view of an imported cycle in every mode", async ({
  page,
}) => {
  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");
  await page.goto("/es/insights/executive");
  const filters = page.getByRole("form", { name: "Filtros" });
  await filters.getByLabel("Ciclo").selectOption({ label: cycleName });
  await filters.getByRole("button", { name: "Aplicar" }).click();
  await expect(page).toHaveURL(/cycle=[0-9a-f-]{36}/);
  await expect(
    page.getByRole("heading", { name: `Vista ejecutiva · ${cycleName}` }),
  ).toBeVisible();
  await expect(page.getByText("Vista completa de People.")).toBeVisible();

  const toggle = page.getByRole("navigation", { name: "Modo" });
  await toggle.getByRole("link", { name: "Cuantitativo" }).click();
  await expect(page).toHaveURL(/mode=quantitative/);
  await expect(page.getByTestId("exec-completion")).toBeVisible();
  await expect(page.getByTestId("exec-self-pct")).toContainText("%");
  await expect(page.getByTestId("exec-retention")).toBeVisible();
  await expect(page.getByTestId("exec-engagement")).toBeVisible();
  await expect(page.getByTestId("exec-risk")).toBeVisible();
  await expect(page.getByTestId("exec-goals")).toBeVisible();
  await expect(page.getByTestId("exec-sentiment")).toHaveCount(0);

  await toggle.getByRole("link", { name: "Cualitativo" }).click();
  await expect(page).toHaveURL(/mode=qualitative/);
  await expect(page.getByTestId("exec-sentiment")).toBeVisible();
  await expect(page.getByTestId("exec-themes")).toBeVisible();
  await expect(page.getByTestId("exec-retention")).toHaveCount(0);
  await expect(
    toggle.getByRole("link", { name: "Cualitativo" }),
  ).toHaveAttribute("aria-current", "true");
});

test("direction sees the masked view; an employee has no access", async ({
  page,
}) => {
  await page.goto("/es");
  await actAsRole(page, "Dirección", "Dirección");
  await page.goto("/es/insights/executive?mode=both");
  await expect(
    page.getByText(/grupos de menos de \d+ personas/).first(),
  ).toBeVisible();
  await expect(page.getByTestId("exec-completion")).toBeVisible();

  await actAsRole(page, "Empleado", "Sin persona");
  await page.goto("/es/insights/executive");
  await expect(page.getByText("Sin acceso.")).toBeVisible();
});

test("self-assessment report page renders", async ({ page }) => {
  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");
  await page.goto("/es/insights/self-assessment");
  await expect(
    page.getByRole("heading", { level: 1, name: /Reporte de autoevaluación/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Completitud por grupo" }),
  ).toBeVisible();
});
