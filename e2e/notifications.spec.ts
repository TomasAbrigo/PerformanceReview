import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { addDays, todayLocal } from "../src/modules/org-history/dates";
import {
  company,
  directReports,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

// Someone in the org on the snapshot day with no reports (so no other
// participant row mentions their name) and a name the selectors can pick.
const employee = find(
  employees,
  (e) => isActive(e) && hasUniqueName(e) && directReports(e).length === 0,
  "person with no reports and a unique name",
);
const employeeName = fullName(employee);

// Phase changes notify every participant, and other specs launch cycles with
// everyone in them, so this spec runs on its own after them (see the
// `notifications` project of playwright.config.ts): the counts below would
// not be deterministic otherwise.

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

/** Launches a cycle with everyone active (self due in 7 days) and moves it to collecting. */
async function collectingCycle(page: Page, name: string, selfDue: string) {
  await page.goto("/es/cycles/new");
  const snapshot = page.getByLabel("Fecha de snapshot organizacional");
  await expect(snapshot).toBeVisible();
  await snapshot.fill(company.asOf);
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
  // Next until the dates step (the wizard may gain optional steps before it).
  const nameField = page.getByLabel("Nombre del ciclo");
  for (let i = 0; i < 4 && !(await nameField.isVisible()); i++) {
    await page.getByRole("button", { name: "Siguiente" }).click();
  }
  await nameField.fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-06-30");
  await page.getByLabel("Autoevaluación").fill(selfDue);
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Pasar a Recolección" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(3);
}

/** `pnpm notifications:run` (what cron runs): its stdout. */
function runGenerator(): string {
  return execFileSync("pnpm", ["notifications:run"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

const badge = (page: Page, label: string) =>
  page.getByRole("link", { name: label });

test("the reminder generator fills the inbox of the people with a pending task", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const name = `Notificaciones e2e ${Date.now()}`;
  await collectingCycle(page, name, addDays(todayLocal(), 7));

  // Launching and moving the cycle told the employee twice; start from a clean inbox.
  await actAs(page, employeeName, "Empleado");
  await page.goto("/es/inbox");
  await expect(
    page.getByRole("heading", { level: 1, name: "Notificaciones" }),
  ).toBeVisible();
  const unread = page.getByRole("region", { name: "No leídas" });
  await expect(
    unread.getByText(
      `El ciclo ${name} se lanzó y está en la fase Nominaciones.`,
    ),
  ).toBeVisible();
  await expect(
    unread.getByText(
      `El ciclo ${name} pasó de la fase Nominaciones a la fase Recolección.`,
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Marcar todas como leídas" }).click();
  await expect(badge(page, "Notificaciones: ninguna sin leer")).toBeVisible();
  await expect(page.getByRole("region", { name: "No leídas" })).toHaveCount(0);

  // Cron: the self assessment is due in 7 days. A second run adds nothing.
  expect(runGenerator()).toMatch(/created=[1-9]/);
  expect(runGenerator()).toMatch(/created=0/);

  // The employee has exactly one new notification: the reminder.
  await page.goto("/es/me");
  await expect(badge(page, "Notificaciones: 1 sin leer")).toBeVisible();
  const reminder = `Tu autoevaluación del ciclo ${name} vence en 7 días`;
  const preview = page.getByRole("region", { name: "Notificaciones nuevas" });
  await expect(preview.getByText(reminder)).toBeVisible();

  // The inbox lists it first, with a link to the form.
  await badge(page, "Notificaciones: 1 sin leer").click();
  await expect(page).toHaveURL(/\/es\/inbox$/);
  const item = page
    .getByRole("region", { name: "No leídas" })
    .getByRole("listitem")
    .filter({ hasText: reminder });
  await expect(item).toHaveCount(1);
  await expect(item.getByRole("link", { name: "Abrir" })).toHaveAttribute(
    "href",
    /\/es\/cycles\/[0-9a-f-]{36}\/self$/,
  );

  // Marking it read moves it to "Leídas" and clears the badge.
  await item.getByRole("button", { name: "Marcar como leída" }).click();
  await expect(badge(page, "Notificaciones: ninguna sin leer")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Leídas" })
      .getByRole("listitem")
      .filter({ hasText: reminder }),
  ).toHaveCount(1);
  await expect(page.getByRole("region", { name: "No leídas" })).toHaveCount(0);

  // Someone else's inbox is separate: HR without a person has none.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto("/es/inbox");
  await expect(page.getByText(/Elegí una persona/)).toBeVisible();
});
