import { expect, test } from "@playwright/test";
import { actAs, actAsRole } from "./act-as";
import { employees, fullName, hasUniqueName } from "./seed-data";

const somebody = fullName(employees.find(hasUniqueName)!);

test("home page renders in Spanish at /es", async ({ page }) => {
  await page.goto("/es");

  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(
    page.getByRole("heading", { level: 1, name: "Performance Review" }),
  ).toBeVisible();
  await expect(page.getByText("Evaluaciones de desempeño")).toBeVisible();
});

const ANALYSIS = [
  "Vista ejecutiva",
  "Completitud",
  "Retención y compromiso",
  "Análisis cualitativo",
  "Autoevaluación",
  "Goals vs. assessments",
  "Análisis 360",
  "Engagement mensual",
];
const DATA = [
  "Subir archivo",
  "Importaciones",
  "Cola de identidad",
  "Calidad de datos",
];

test("home navigation puts Goals and Assessments first, then the Análisis, Datos and Configuración", async ({
  page,
}) => {
  await page.goto("/es");
  const nav = page.getByRole("navigation", { name: "Navegación" });
  await expect(nav.getByRole("heading", { level: 2 })).toHaveText([
    "Goals",
    "Assessments",
    "Análisis",
    "Datos",
    "Configuración",
  ]);
  await expect(nav.getByRole("link")).toHaveText([
    "Goals",
    "Assessments",
    ...ANALYSIS,
    ...DATA,
    "Ajustes de insights",
  ]);
  // Every link has a short description under it.
  await expect(nav.getByRole("listitem")).toHaveCount(15);
  await expect(
    nav.getByRole("listitem").filter({ hasText: "Vista ejecutiva" }),
  ).toContainText("Completitud, retención, compromiso");
  await expect(
    nav.getByRole("listitem").filter({ hasText: "Assessments" }).first(),
  ).toContainText("Las preguntas y respuestas de cada ciclo");
});

test("the sidebar lists the same sections in the same order and marks the current one", async ({
  page,
}) => {
  await page.goto("/es");
  const side = page.getByRole("navigation", { name: "Secciones" });
  await expect(side.getByRole("link")).toHaveText([
    "", // the logo, named by its aria-label
    "Goals",
    "Assessments",
    ...ANALYSIS,
    ...DATA,
    "Ajustes de insights",
  ]);
  await side.getByRole("link", { name: "Assessments", exact: true }).click();
  await expect(page).toHaveURL(/\/es\/assessments$/);
  await expect(
    page.getByRole("navigation", { name: "Secciones" }).getByRole("link", {
      name: "Assessments",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("navigation", { name: "Secciones" }).getByRole("link", {
      name: "Goals",
      exact: true,
    }),
  ).not.toHaveAttribute("aria-current", "page");
});

test("each role only gets the sections it may open", async ({ page }) => {
  await page.goto("/es");
  // Direction reads aggregates: the Análisis, never individual goals or assessments.
  await actAsRole(page, "Dirección", "Dirección");
  const nav = page.getByRole("navigation", { name: "Navegación" });
  await expect(nav.getByRole("heading", { level: 2 })).toHaveText(["Análisis"]);
  await expect(nav.getByRole("link")).toHaveText(ANALYSIS);
  await expect(page.getByRole("link", { name: "Subir archivo" })).toHaveCount(
    0,
  );

  // An employee: their goals and assessments, no analysis, nothing of People's
  // (the person picker is off while acting as direction: leave it first).
  await actAsRole(page, "Empleado", "Sin persona");
  await actAs(page, somebody, "Empleado");
  await expect(nav.getByRole("heading", { level: 2 })).toHaveText([
    "Goals",
    "Assessments",
  ]);
  await expect(nav.getByRole("link")).toHaveText(["Goals", "Assessments"]);

  // A manager: those two and the Análisis, still no Datos or Configuración.
  await actAs(page, somebody, "Manager");
  await expect(nav.getByRole("heading", { level: 2 })).toHaveText([
    "Goals",
    "Assessments",
    "Análisis",
  ]);
});

test("Goals and Assessments send direction to the analysis (aggregates only)", async ({
  page,
}) => {
  await page.goto("/es");
  await actAsRole(page, "Dirección", "Dirección");
  await page.goto("/es/goals");
  await expect(page).toHaveURL(/\/es\/insights\/goals$/);
  await page.goto("/es/assessments");
  await expect(page).toHaveURL(/\/es\/insights\/completion$/);
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
