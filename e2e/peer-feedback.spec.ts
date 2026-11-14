import { expect, type Page, test } from "@playwright/test";
import {
  byId,
  company,
  directReports,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

const eligible = (e: (typeof employees)[number]) =>
  isActive(e) && hasUniqueName(e) && directReports(e).length === 0;

// A reviewee whose (active, uniquely named) manager is the snapshot manager,
// and two active peers to nominate (not the reviewee, not the manager).
const reviewee = find(
  employees,
  (e) =>
    eligible(e) &&
    e.managerId !== null &&
    byId.has(e.managerId) &&
    isActive(byId.get(e.managerId)!) &&
    hasUniqueName(byId.get(e.managerId)!),
  "reviewee with a manager",
);
const manager = byId.get(reviewee.managerId!)!;
const [peer, otherPeer] = employees.filter(
  (e) => eligible(e) && e.id !== reviewee.id && e.id !== manager.id,
);
const revieweeName = fullName(reviewee);
const managerName = fullName(manager);
const peerName = fullName(peer);
const otherPeerName = fullName(otherPeer);

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

/** Launches a cycle with peers on (default anonymity: anonymous to employee). */
async function nominationsCycle(page: Page, name: string) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill(company.asOf);
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByLabel("Máximo de nominaciones de pares")).toHaveValue(
    "5",
  );
  // Without calibration, sharing needs no published calibration (#16).
  await page.getByLabel("Calibración", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-06-30");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  return page.url();
}

async function fillAndSubmit(page: Page) {
  const boxes = page.getByRole("textbox", { name: /\?|\.|People/ });
  await expect(boxes.first()).toBeVisible();
  const count = await boxes.count();
  for (let i = 0; i < count; i++) {
    await boxes.nth(i).fill(`Respuesta ${i + 1}`);
    await boxes.nth(i).blur();
  }
  const groups = page.getByRole("radiogroup");
  for (let i = 0; i < (await groups.count()); i++) {
    await groups.nth(i).getByRole("radio").first().check();
  }
  await expect(page.getByText("Borrador guardado")).toBeVisible();
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(page.getByText(/Enviado el/)).toBeVisible();
}

const openTask = (page: Page, text: string) =>
  page
    .getByRole("listitem")
    .filter({ hasText: text })
    .getByRole("link", { name: "Abrir" })
    .click();

test("nominate, approve, answer: the manager sees the name, the employee a 'Par'", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const name = `Pares e2e ${Date.now()}`;
  const cycleUrl = await nominationsCycle(page, name);

  // The reviewee nominates two peers (their manager is not eligible).
  await actAs(page, revieweeName, "Empleado");
  await page.goto("/es/me");
  await openTask(page, `Nominar pares en ${name}`);
  await expect(page.getByText("0 de 5 nominaciones")).toBeVisible();
  await expect(
    page.getByLabel("Colega a nominar").locator("option", {
      hasText: managerName,
    }),
  ).toHaveCount(0);
  await page.getByLabel("Colega a nominar").selectOption({ label: peerName });
  await page.getByRole("button", { name: "Nominar" }).click();
  await expect(page.getByText("1 de 5 nominaciones")).toBeVisible();
  await page
    .getByLabel("Colega a nominar")
    .selectOption({ label: otherPeerName });
  await page.getByRole("button", { name: "Nominar" }).click();
  await expect(page.getByText("2 de 5 nominaciones")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: peerName }),
  ).toContainText("Pendiente");

  // The manager approves both from the team page.
  await actAs(page, managerName, "Manager");
  await page.goto("/es/team");
  const approvals = page.getByRole("region", {
    name: "Nominaciones para aprobar",
  });
  for (const nominee of [peerName, otherPeerName]) {
    await approvals
      .getByRole("listitem")
      .filter({ hasText: name })
      .filter({ hasText: nominee })
      .getByRole("button", { name: "Aprobar" })
      .click();
    await expect(
      approvals
        .getByRole("listitem")
        .filter({ hasText: name })
        .filter({ hasText: nominee }),
    ).toHaveCount(0);
  }
  await expect(
    approvals.getByRole("listitem").filter({ hasText: name }),
  ).toHaveCount(0);

  // People opens collecting.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto(cycleUrl);
  await page.getByRole("button", { name: "Pasar a Recolección" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(3);

  // The first peer answers.
  await actAs(page, peerName, "Empleado");
  await page.goto("/es/me");
  await openTask(page, `Feedback para ${revieweeName} (${name})`);
  await expect(
    page.getByText(/verá tu feedback como "Par", sin tu nombre/),
  ).toBeVisible();
  await fillAndSubmit(page);

  // The reviewee submits their self assessment.
  await actAs(page, revieweeName, "Empleado");
  await page.goto("/es/me");
  await page
    .getByRole("listitem")
    .filter({ hasText: `Autoevaluación: ${name}` })
    .getByRole("link", { name: "Completar" })
    .click();
  await expect(page).toHaveURL(/\/self$/);
  await fillAndSubmit(page);

  // The manager reads it with the peer's name, then reviews.
  await actAs(page, managerName, "Manager");
  await page.goto("/es/team");
  await page.getByRole("link", { name: `${revieweeName} (${name})` }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: peerName }),
  ).toBeVisible();
  await page.goto("/es/team");
  await page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ hasText: revieweeName })
    .getByRole("link", { name: "Evaluar" })
    .click();
  await fillAndSubmit(page);
  const managerUrl = page.url();

  // People moves the cycle to sharing; the manager shares.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto(cycleUrl);
  for (const [phase, rows] of [
    ["Revisión del manager", 4],
    ["Compartir resultados", 5],
  ] as const) {
    await page.getByRole("button", { name: `Pasar a ${phase}` }).click();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(
      page
        .getByRole("table", { name: "Historial de estados" })
        .getByRole("row"),
    ).toHaveCount(rows);
  }
  await actAs(page, managerName, "Manager");
  await page.goto(managerUrl);
  await page.getByRole("button", { name: "Compartir con el empleado" }).click();
  await expect(page.getByText(/Compartida el/)).toBeVisible();

  // The reviewee sees it labelled "Par", without the peer's name.
  await actAs(page, revieweeName, "Empleado");
  await page.goto("/es/me");
  await openTask(page, `Ver feedback de pares (${name})`);
  await expect(
    page.getByRole("heading", { level: 2, name: "Par", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByText(peerName)).toHaveCount(0);
});
