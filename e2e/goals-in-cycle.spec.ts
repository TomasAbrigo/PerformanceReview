import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

/** Uses the header "Actuar como" selector. */
async function actAs(page: Page, person: string | null, role: string) {
  const bar = page.getByRole("form", { name: "Actuar como" });
  if (person) await bar.getByLabel("Buscar persona").fill(person);
  await bar
    .getByLabel("Persona", { exact: true })
    .selectOption({ label: person ?? "Sin persona" });
  await bar.getByLabel("Rol").selectOption({ label: role });
  await bar.getByRole("button", { name: "Aplicar" }).click();
  await expect(bar.getByText(/Actuando como:/)).toContainText(
    person ?? "People",
  );
}

/**
 * Launches a cycle over the seeded goals' dates (Bruno's three goals are due
 * in 2026-12-31, 2026-09-30 and 2027-02-28) and moves it to collecting.
 * The org snapshot (2022-06-01) is what makes Carla Bruno's manager.
 */
async function collectingCycle(page: Page, name: string) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();
  // Ana, Bruno and Carla had a job on that day (today only two do): filling
  // it again until the form took it keeps a slow hydration from eating it.
  await expect(async () => {
    await page
      .getByLabel("Fecha de snapshot organizacional")
      .fill("2022-06-01");
    await expect(page.getByText("3 personas coinciden")).toBeVisible({
      timeout: 3_000,
    });
  }).toPass();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page
    .getByLabel("Plantilla")
    .selectOption({ label: "Evaluación de fin de año" });
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2026-07-01");
  await page.getByLabel("Fin del período").fill("2026-12-31");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  const cycleId = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: "Pasar a Recolección" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(3);
  return cycleId;
}

/** The legend date `date` as the app shows it (es, medium, a calendar day). */
const legend = (isoDay: string) =>
  `Progreso al ${new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${isoDay}T00:00:00Z`))}`;

/** Today in the company's time zone, as the legend counts it. */
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());

/** Rewrites the snapshot of a cycle as if it had been taken long ago. */
async function ageSnapshot(cycleId: string) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // rely on the real environment (CI)
  }
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  try {
    await sql`
      UPDATE participant_goal_snapshot
      SET captured_at = '2026-01-15T12:00:00Z', refreshed_at = NULL,
          percent_complete = 5, status = 'in_progress'
      WHERE participant_id IN (
        SELECT id FROM cycle_participant WHERE cycle_id = ${cycleId}
      )`;
  } finally {
    await sql.end();
  }
}

const BRUNO_GOALS = [
  "Reducir el tiempo de primera respuesta de soporte",
  "Obtener la certificación AWS",
  "Documentar los runbooks de guardia",
];

test("the cycle snapshots the goals; both reviews show them and the manager refreshes the progress", async ({
  page,
}) => {
  const name = `Goals e2e ${Date.now()}`;
  const cycleId = await collectingCycle(page, name);

  // Bruno's self assessment shows his goals, read-only, as of today.
  await actAs(page, "Bruno Pérez", "Empleado");
  await page.goto(`/es/cycles/${cycleId}/self`);
  const selfGoals = page.getByRole("region", { name: "Objetivos del período" });
  await expect(selfGoals.getByRole("listitem")).toHaveCount(3);
  for (const title of BRUNO_GOALS) {
    await expect(selfGoals.getByText(title)).toBeVisible();
  }
  await expect(selfGoals.getByText(legend(today()))).toBeVisible();
  await expect(
    selfGoals.getByRole("button", { name: "Actualizar progreso" }),
  ).toHaveCount(0);

  // Carla (his manager at the snapshot) sees the block and the goals rating.
  await actAs(page, "Carla Romero", "Manager");
  await page.goto("/es/team");
  const row = page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ hasText: "Bruno Pérez" });
  await row.getByRole("link", { name: "Evaluar" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Evaluación de Bruno Pérez" }),
  ).toBeVisible();
  const goals = page.getByRole("region", { name: "Objetivos del período" });
  await expect(goals.getByRole("listitem")).toHaveCount(3);
  const rating = page.getByRole("radiogroup", {
    name: /avance en sus objetivos/,
  });
  await expect(rating).toBeVisible();
  await expect(rating).toHaveAttribute("aria-required", "true");
  await expect(
    page.getByLabel(/Calificación general de desempeño/),
  ).toBeVisible();

  // The snapshot was taken long ago: the legend says so, until she refreshes.
  await ageSnapshot(cycleId);
  await page.reload();
  await expect(goals.getByText(legend("2026-01-15"))).toBeVisible();
  await expect(goals.getByText("5%", { exact: true })).toHaveCount(3);
  await goals.getByRole("button", { name: "Actualizar progreso" }).click();
  await expect(goals.getByText(legend(today()))).toBeVisible();
  await expect(goals.getByText(legend("2026-01-15"))).toHaveCount(0);
  // The figures moved, the list did not.
  await expect(goals.getByText("55%", { exact: true })).toBeVisible();
  await expect(goals.getByText("100%", { exact: true })).toBeVisible();
  await expect(goals.getByRole("listitem")).toHaveCount(3);
});

test("a participant without goals can be reviewed: the goals rating is optional", async ({
  page,
}) => {
  const name = `Sin goals e2e ${Date.now()}`;
  await collectingCycle(page, name);

  // Carla has no goals; Ana is her manager at the snapshot.
  await actAs(page, "Ana García", "Manager");
  await page.goto("/es/team");
  const row = page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ hasText: "Carla Romero" });
  await row.getByRole("link", { name: "Evaluar" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Evaluación de Carla Romero" }),
  ).toBeVisible();
  await expect(
    page.getByText(/No hay objetivos en este período/),
  ).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: /avance en sus objetivos/ }),
  ).toHaveAttribute("aria-required", "false");
  await expect(
    page.getByRole("radiogroup", { name: /Calificación general/ }),
  ).toHaveAttribute("aria-required", "true");
});
