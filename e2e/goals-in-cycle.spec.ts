import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { e2eDatabaseUrl } from "./database";
import {
  byId,
  company,
  employees,
  find,
  fullName,
  goalsOf,
  hasUniqueName,
  isActive,
} from "./seed-data";

/** An active person with a unique name whose manager (today = at the snapshot) is one too. */
const hasManagerPerson = (e: (typeof employees)[number]) =>
  isActive(e) &&
  hasUniqueName(e) &&
  e.managerId !== null &&
  byId.has(e.managerId) &&
  isActive(byId.get(e.managerId)!) &&
  hasUniqueName(byId.get(e.managerId)!);

// Someone with goals (the period below spans all their dates, so the snapshot
// holds every one of them) and someone who never set any.
const withGoals = find(
  employees,
  (e) => hasManagerPerson(e) && goalsOf(e).length >= 2,
  "active person with goals and a manager with a unique name",
);
const withoutGoals = find(
  employees,
  (e) => hasManagerPerson(e) && goalsOf(e).length === 0,
  "active person without goals and a manager with a unique name",
);
const nameOf = (e: (typeof employees)[number]) => fullName(e);
const managerOf = (e: (typeof employees)[number]) =>
  nameOf(byId.get(e.managerId!)!);

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
 * Launches a cycle whose period covers every date of the generated goals (so
 * each goal of a participant overlaps it) and moves it to collecting. The org
 * snapshot date is the company's own, which is what makes the generated
 * manager the participant's manager.
 */
async function collectingCycle(page: Page, name: string) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();
  // Filling the date again until the form took it keeps a slow hydration from
  // eating it: the preview then matches whoever had a job that day.
  await expect(async () => {
    await page
      .getByLabel("Fecha de snapshot organizacional")
      .fill(company.asOf);
    await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible({
      timeout: 3_000,
    });
  }).toPass();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page
    .getByLabel("Plantilla")
    .selectOption({ label: "Evaluación de fin de año" });
  await page.getByLabel("Calibración", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2000-01-01");
  await page.getByLabel("Fin del período").fill("2099-12-31");
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

/** The legend as the app shows it (es, medium date, a calendar day). */
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

/** Rewrites the snapshot of a cycle as if it had been taken long ago, with other figures. */
async function ageSnapshot(cycleId: string) {
  const sql = postgres(e2eDatabaseUrl(), { max: 1 });
  try {
    await sql`
      UPDATE participant_goal_snapshot
      SET captured_at = '2026-01-15T12:00:00Z', refreshed_at = NULL,
          percent_complete = (percent_complete + 37) % 101
      WHERE participant_id IN (
        SELECT id FROM cycle_participant WHERE cycle_id = ${cycleId}
      )`;
  } finally {
    await sql.end();
  }
}

test("the cycle snapshots the goals; both reviews show them and the manager refreshes the progress", async ({
  page,
}) => {
  const name = `Goals e2e ${Date.now()}`;
  const goals = goalsOf(withGoals);
  const cycleId = await collectingCycle(page, name);

  // The employee's self assessment shows their goals, read-only, as of today.
  await actAs(page, nameOf(withGoals), "Empleado");
  await page.goto(`/es/cycles/${cycleId}/self`);
  const selfGoals = page.getByRole("region", { name: "Objetivos del período" });
  await expect(selfGoals.getByRole("listitem")).toHaveCount(goals.length);
  await expect(
    selfGoals.getByText(goals[0].title, { exact: true }).first(),
  ).toBeVisible();
  await expect(selfGoals.getByText(legend(today()))).toBeVisible();
  await expect(
    selfGoals.getByRole("button", { name: "Actualizar progreso" }),
  ).toHaveCount(0);

  // Their manager (at the snapshot) sees the block and the goals rating.
  await actAs(page, managerOf(withGoals), "Manager");
  await page.goto("/es/team");
  const row = page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ hasText: nameOf(withGoals) });
  await row.getByRole("link", { name: "Evaluar" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Evaluación de ${nameOf(withGoals)}`,
    }),
  ).toBeVisible();
  const block = page.getByRole("region", { name: "Objetivos del período" });
  await expect(block.getByRole("listitem")).toHaveCount(goals.length);
  const rating = page.getByRole("radiogroup", {
    name: /avance en sus objetivos/,
  });
  await expect(rating).toBeVisible();
  await expect(rating).toHaveAttribute("aria-required", "true");
  await expect(
    page.getByLabel(/Calificación general de desempeño/),
  ).toBeVisible();

  // The snapshot was taken long ago, with other figures: the legend says so,
  // until the manager refreshes.
  await ageSnapshot(cycleId);
  await page.reload();
  const first = block.getByRole("listitem").first();
  await expect(block.getByText(legend("2026-01-15"))).toBeVisible();
  await expect(first.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    String((goals[0].percentComplete + 37) % 101),
  );
  await block.getByRole("button", { name: "Actualizar progreso" }).click();
  await expect(block.getByText(legend(today()))).toBeVisible();
  await expect(block.getByText(legend("2026-01-15"))).toHaveCount(0);
  // The figures moved back to the goal's, the list did not change.
  await expect(first.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    String(goals[0].percentComplete),
  );
  await expect(block.getByRole("listitem")).toHaveCount(goals.length);
});

test("a participant without goals can be reviewed: the goals rating is optional", async ({
  page,
}) => {
  const name = `Sin goals e2e ${Date.now()}`;
  await collectingCycle(page, name);

  await actAs(page, managerOf(withoutGoals), "Manager");
  await page.goto("/es/team");
  const row = page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ hasText: nameOf(withoutGoals) });
  await row.getByRole("link", { name: "Evaluar" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Evaluación de ${nameOf(withoutGoals)}`,
    }),
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
