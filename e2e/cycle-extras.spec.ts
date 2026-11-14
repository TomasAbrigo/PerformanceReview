import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { addDays } from "../src/modules/review-core/hire-date-schedule";
import {
  byId,
  company,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

const NEXT = { name: "Siguiente" };

// Participants are resolved (and frozen) as of the fictional "today" of the
// generated company, like in cycles.spec.ts.
const snapshot = company.asOf;

/** Opens the wizard and moves to the groups step (step 3 of 5). */
async function openGroupsStep(page: Page) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill(snapshot);
  await expect(page.getByText(/\d+ personas? coinciden?/)).toBeVisible();
  await page.getByRole("button", NEXT).click();
  await page.getByRole("button", NEXT).click();
  await expect(page.getByText("Paso 3 de 5")).toBeVisible();
}

/** From the groups step: name and period, then the dates step's own fields. */
async function fillBasics(page: Page, name: string) {
  await page.getByRole("button", NEXT).click();
  await expect(page.getByText("Paso 4 de 5")).toBeVisible();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-12-31");
}

async function createAndLaunch(page: Page) {
  await page.getByRole("button", NEXT).click();
  await expect(page.getByText("Paso 5 de 5")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Crear y lanzar" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
}

const participantsTable = (page: Page) =>
  page.getByRole("table", { name: "Participantes" });

test("duplicates a launched cycle into a draft that can be launched on its own", async ({
  page,
}) => {
  const name = `Ciclo base ${Date.now()}`;
  await openGroupsStep(page);
  await fillBasics(page, name);
  await page.getByLabel("Autoevaluación").fill("2022-07-15");
  await createAndLaunch(page);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Nominaciones").first()).toBeVisible();
  const originalPath = new URL(page.url()).pathname;

  // Duplicate: a new draft with the same settings and no participants.
  await page.getByRole("button", { name: "Duplicar ciclo" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `${name} (Copia)` }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).not.toBe(originalPath);
  await expect(page.getByText("Borrador").first()).toBeVisible();
  await expect(
    page.getByText("Este ciclo todavía no tiene participantes."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Duplicado desde otro ciclo" }),
  ).toHaveAttribute("href", originalPath);

  // The copy launches by itself with the snapshot it inherited: the row of
  // someone with a manager freezes that manager.
  await page.getByRole("button", { name: "Lanzar ciclo" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  const member = find(
    employees,
    (e) =>
      isActive(e) &&
      hasUniqueName(e) &&
      e.managerId !== null &&
      byId.has(e.managerId) &&
      hasUniqueName(byId.get(e.managerId)!),
    "person with a manager",
  );
  const row = participantsTable(page)
    .getByRole("row")
    .filter({ hasText: fullName(member) });
  await expect(
    row.getByText(fullName(byId.get(member.managerId!)!)),
  ).toBeVisible();
  await expect(page.getByText("Nominaciones").first()).toBeVisible();

  // Both cycles are listed, and the original is untouched.
  await page.goto("/es/cycles");
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Nominaciones").first()).toBeVisible();
});

test("creates a cycle with template groups and shows who got which group", async ({
  page,
}) => {
  const name = `Ciclo grupos ${Date.now()}`;
  const groupName = `Grupo e2e ${Date.now()}`;
  const member = find(
    employees,
    (e) => isActive(e) && hasUniqueName(e),
    "active person",
  );
  const other = find(
    employees,
    (e) =>
      isActive(e) && hasUniqueName(e) && e.department !== member.department,
    "active person in another department",
  );
  await openGroupsStep(page);
  await expect(
    page.getByText(
      "Todavía no hay grupos: todas las personas usan la plantilla del ciclo.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Agregar grupo" }).click();
  const group = page.getByRole("group", { name: "Grupo 1" });
  await group.getByLabel("Nombre del grupo").fill(groupName);
  await group.getByLabel("Plantilla del grupo").selectOption({ index: 1 });
  await group
    .getByRole("checkbox", { name: member.department, exact: true })
    .check();
  await expect(group.getByText(/^\d+ personas?$/)).toBeVisible();
  await expect(
    page.getByText(/sin grupo usan? la plantilla del ciclo/),
  ).toBeVisible();

  await fillBasics(page, name);
  await createAndLaunch(page);

  const groups = page.getByRole("region", { name: "Plantillas por grupo" });
  await expect(
    groups.getByRole("row").filter({ hasText: groupName }),
  ).toBeVisible();
  await expect(groups.getByText(/Plantilla del ciclo:/)).toBeVisible();
  const inGroup = participantsTable(page)
    .getByRole("row")
    .filter({ hasText: fullName(member) });
  await expect(inGroup.getByText(groupName)).toBeVisible();
  const outside = participantsTable(page)
    .getByRole("row")
    .filter({ hasText: fullName(other) });
  await expect(outside.getByText("Sin grupo")).toBeVisible();
});

test("a hire-date cycle enrolls people through the cycles:enroll CLI", async ({
  page,
}) => {
  const name = `Ciclo ingreso ${Date.now()}`;
  // Someone whose 1-year milestone (plus a few days) is already in the past
  // of the generated company: they were employed on the enrollment date.
  const hired = find(
    employees,
    (e) =>
      isActive(e) &&
      hasUniqueName(e) &&
      addDays(e.hireDate, 368) <= company.asOf,
    "active person hired over a year ago",
  );
  const milestone = addDays(hired.hireDate, 365);
  const enrollOn = addDays(milestone, 3);

  await openGroupsStep(page);
  await fillBasics(page, name);
  await page.getByLabel("Por fecha de ingreso").check();
  await page.getByLabel("Hito").selectOption({ label: "1 año (365 días)" });
  await page.getByLabel("Ventana").selectOption({ label: "1 semana" });
  await expect(page.getByText(/ingresó el \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(
    page.getByText(/Cumple el hito el \d{4}-\d{2}-\d{2}/),
  ).toBeVisible();
  await createAndLaunch(page);

  // Launching enrolls whoever is due today, and nobody is yet.
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(
    page
      .getByRole("main")
      .locator("header")
      .getByText("Hito: 1 año (365 días) · ventana de 1 semana"),
  ).toBeVisible();

  // The CLI enrolls them with their own snapshot and deadline; the second
  // run (same day) adds no one.
  const id = page.url().split("/").pop()!;
  const first = execFileSync(
    "pnpm",
    ["cycles:enroll", "--cycle", id, "--as-of", enrollOn],
    { encoding: "utf8" },
  );
  expect(first).toContain(fullName(hired));
  const again = execFileSync(
    "pnpm",
    ["cycles:enroll", "--cycle", id, "--as-of", enrollOn],
    { encoding: "utf8" },
  );
  expect(again).toContain("0 enrolled");

  await page.reload();
  const row = participantsTable(page)
    .getByRole("row")
    .filter({ hasText: fullName(hired) });
  // Own deadline: milestone + 1 week.
  await expect(row.getByText(addDays(milestone, 7))).toBeVisible();
});
