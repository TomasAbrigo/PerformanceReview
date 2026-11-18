import { expect, test } from "@playwright/test";

test("home page renders in Spanish at /es", async ({ page }) => {
  await page.goto("/es");

  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(
    page.getByRole("heading", { level: 1, name: "Performance Review" }),
  ).toBeVisible();
  await expect(page.getByText("Evaluaciones de desempeño")).toBeVisible();
});

test("home navigation lists only the remaining sections", async ({ page }) => {
  await page.goto("/es");
  const nav = page.getByRole("navigation", { name: "Configuración" });
  await expect(nav.getByRole("link")).toHaveText([
    "Personas",
    "Organigrama",
    "Ciclos de evaluación",
    "Objetivos del equipo",
    "Dashboards",
    "Completitud",
    "Retención y compromiso",
    "Análisis cualitativo",
    "Reporte de autoevaluación",
    "Vista ejecutiva",
    "Goals y assessments",
    "Análisis 360 por DM",
    "Engagement mensual",
    "Importaciones",
    "Subir archivo",
    "Cola de identidad",
    "Calidad de datos",
    "Insights",
    "Templates de evaluación",
    "Escalas de rating",
  ]);
  // The removed flows have no route anymore.
  for (const path of ["/es/me", "/es/team", "/es/inbox"]) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(404);
  }
  // "new" is not a cycle id: the (streamed) cycle page renders not found.
  await page.goto("/es/cycles/new");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await page.goto("/es");
  // Nor a notifications bell or a "my tasks" link in the header.
  await expect(page.getByRole("link", { name: "Mis tareas" })).toHaveCount(0);
});
