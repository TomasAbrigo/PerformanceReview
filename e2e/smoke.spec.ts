import { expect, test } from "@playwright/test";
import { actAsRole } from "./act-as";

test("home page renders in Spanish at /es", async ({ page }) => {
  await page.goto("/es");

  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(
    page.getByRole("heading", { level: 1, name: "Performance Review" }),
  ).toBeVisible();
  await expect(page.getByText("Evaluaciones de desempeño")).toBeVisible();
});

test("home navigation is grouped: Insights, Datos and Configuración", async ({
  page,
}) => {
  await page.goto("/es");
  const nav = page.getByRole("navigation", { name: "Navegación" });
  await expect(nav.getByRole("heading", { level: 2 })).toHaveText([
    "Insights",
    "Datos",
    "Configuración",
  ]);
  await expect(nav.getByRole("link")).toHaveText([
    "Vista ejecutiva",
    "Completitud",
    "Retención y compromiso",
    "Análisis cualitativo",
    "Reporte de autoevaluación",
    "Goals y assessments",
    "Análisis 360 por DM",
    "Engagement mensual",
    "Subir archivo",
    "Importaciones",
    "Cola de identidad",
    "Calidad de datos",
    "Ajustes de insights",
  ]);
  // Every link has a short description under it.
  await expect(nav.getByRole("listitem")).toHaveCount(13);
  await expect(
    nav.getByRole("listitem").filter({ hasText: "Vista ejecutiva" }),
  ).toContainText("Completitud, retención, compromiso");
});

test("the other roles only see the Insights group", async ({ page }) => {
  await page.goto("/es");
  await actAsRole(page, "Empleado", "Sin persona");
  const nav = page.getByRole("navigation", { name: "Navegación" });
  await expect(nav.getByRole("heading", { level: 2 })).toHaveText(["Insights"]);
  await expect(nav.getByRole("link")).toHaveCount(8);
  await expect(page.getByRole("link", { name: "Subir archivo" })).toHaveCount(
    0,
  );
});

test("the removed v1 screens have no route anymore", async ({ page }) => {
  for (const path of [
    "/es/people",
    "/es/org",
    "/es/cycles",
    "/es/team/goals",
    "/es/dashboards",
    "/es/settings/templates",
    "/es/settings/scales",
    "/es/me",
    "/es/team",
    "/es/inbox",
  ]) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(404);
  }
  await page.goto("/es");
  // Nor a notifications bell or a "my tasks" link in the header.
  await expect(page.getByRole("link", { name: "Mis tareas" })).toHaveCount(0);
});
