import { expect, test } from "@playwright/test";
import {
  byId,
  company,
  directReports,
  employedOn,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

// Participants are resolved (and frozen) as of the fictional "today" of the
// generated company: the managers of the current job rows are resolved there
// (older rows only carry the manager's name).
const snapshot = company.asOf;
const inOrg = employedOn(snapshot);
const personasCoinciden = (n: number) =>
  `${n} ${n === 1 ? "persona coincide" : "personas coinciden"}`;

test("creates and launches a cycle with a frozen org snapshot", async ({
  page,
}) => {
  await page.goto("/es/cycles");
  await expect(
    page.getByRole("heading", { level: 1, name: "Ciclos de evaluación" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Nuevo ciclo" }).click();

  // Step 1: everyone in the org on the snapshot date.
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill(snapshot);
  await expect(page.getByText(personasCoinciden(inOrg.length))).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();

  // Step 2: defaults.
  await expect(page.getByText("Paso 2 de 4")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();

  // Step 3: name, period and due dates.
  const name = `Ciclo e2e ${Date.now()}`;
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-06-30");
  await page.getByLabel("Autoevaluación").fill("2022-07-15");
  await page.getByRole("button", { name: "Siguiente" }).click();

  // Step 4: review and launch.
  await expect(page.getByText("Paso 4 de 4")).toBeVisible();
  await expect(
    page.getByText(`Se lanzará con ${inOrg.length} participantes`),
  ).toBeVisible();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();

  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Nominaciones").first()).toBeVisible();

  const participants = page.getByRole("table", { name: "Participantes" });
  // Someone with no reports (so no other row mentions them) and a manager
  // who was in the org that day: the row freezes the manager and the job.
  const member = find(
    employees,
    (e) =>
      isActive(e) &&
      hasUniqueName(e) &&
      directReports(e).length === 0 &&
      e.managerId !== null &&
      hasUniqueName(byId.get(e.managerId)!),
    "person with a manager and no reports",
  );
  const row = participants
    .getByRole("row")
    .filter({ hasText: fullName(member) });
  await expect(
    row.getByText(fullName(byId.get(member.managerId!)!)),
  ).toBeVisible();
  await expect(row.getByText(member.jobTitle, { exact: true })).toBeVisible();
  const ceo = find(employees, (e) => e.managerId === null, "CEO");
  const top = participants.getByRole("row").filter({ hasText: fullName(ceo) });
  await expect(top.getByText("Sin manager")).toBeVisible();

  const log = page.getByRole("table", { name: "Historial de estados" });
  await expect(log.getByText("Borrador")).toBeVisible();

  // Phase action with confirmation.
  await page.getByRole("button", { name: "Pasar a Recolección" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(log.getByRole("row")).toHaveCount(3);

  // The cycle shows up in the list.
  await page.goto("/es/cycles");
  await expect(page.getByRole("link", { name })).toBeVisible();
});
