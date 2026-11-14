import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";

const NEXT = { name: "Siguiente" };

/** Opens the wizard and moves to the groups step (step 3 of 5). */
async function openGroupsStep(page: Page, snapshot = "2022-06-01") {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill(snapshot);
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
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

  // The copy launches by itself with the snapshot it inherited.
  await page.getByRole("button", { name: "Lanzar ciclo" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  const bruno = participantsTable(page)
    .getByRole("row")
    .filter({ hasText: "Bruno Pérez" });
  await expect(bruno.getByText("Carla Romero")).toBeVisible();
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
  await openGroupsStep(page);
  await expect(
    page.getByText(
      "Todavía no hay grupos: todas las personas usan la plantilla del ciclo.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Agregar grupo" }).click();
  const group = page.getByRole("group", { name: "Grupo 1" });
  await group.getByLabel("Nombre del grupo").fill("Ingeniería");
  await group.getByLabel("Plantilla del grupo").selectOption({ index: 1 });
  await group.getByRole("checkbox", { name: "Ingeniería" }).check();
  await expect(group.getByText(/^\d+ personas?$/)).toBeVisible();
  await expect(
    page.getByText(/sin grupo usan? la plantilla del ciclo/),
  ).toBeVisible();

  await fillBasics(page, name);
  await createAndLaunch(page);

  const groups = page.getByRole("region", { name: "Plantillas por grupo" });
  const row = groups.getByRole("row").filter({ hasText: "Ingeniería" });
  await expect(row).toBeVisible();
  await expect(groups.getByText(/Plantilla del ciclo:/)).toBeVisible();
  const bruno = participantsTable(page)
    .getByRole("row")
    .filter({ hasText: "Bruno Pérez" });
  await expect(
    bruno.getByText("Ingeniería", { exact: true }).last(),
  ).toBeVisible();
  const ana = participantsTable(page)
    .getByRole("row")
    .filter({ hasText: "Ana García" });
  await expect(ana.getByText("Sin grupo")).toBeVisible();
});

test("a hire-date cycle enrolls people through the cycles:enroll CLI", async ({
  page,
}) => {
  const name = `Ciclo ingreso ${Date.now()}`;
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

  // Launching enrolls whoever is due today: nobody in the fixtures.
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(
    page
      .getByRole("main")
      .locator("header")
      .getByText("Hito: 1 año (365 días) · ventana de 1 semana"),
  ).toBeVisible();
  await expect(
    page.getByText("Este ciclo todavía no tiene participantes."),
  ).toBeVisible();

  // Bruno was hired on 2021-07-15: his 1-year milestone is 2022-07-15.
  const id = page.url().split("/").pop()!;
  const first = execFileSync(
    "pnpm",
    ["cycles:enroll", "--cycle", id, "--as-of", "2022-07-18"],
    { encoding: "utf8" },
  );
  expect(first).toContain("1 enrolled");
  expect(first).toContain("Bruno Pérez");
  const again = execFileSync(
    "pnpm",
    ["cycles:enroll", "--cycle", id, "--as-of", "2022-07-18"],
    { encoding: "utf8" },
  );
  expect(again).toContain("0 enrolled");

  await page.reload();
  const rows = participantsTable(page).getByRole("row");
  await expect(rows).toHaveCount(2); // header + Bruno only
  const bruno = rows.filter({ hasText: "Bruno Pérez" });
  // Snapshot as of the enrollment date; own deadline: milestone + 1 week.
  await expect(bruno.getByText("Carla Romero")).toBeVisible();
  await expect(bruno.getByText("2022-07-22")).toBeVisible();
});
