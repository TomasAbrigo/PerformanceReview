import { expect, type Page, test } from "@playwright/test";

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

/** Launches a year-end cycle and moves it to collecting; returns its URL. */
async function collectingCycle(page: Page, name: string) {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 4")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill("2022-06-01");
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page
    .getByLabel("Plantilla")
    .selectOption({ label: "Evaluación de fin de año" });
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-06-30");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Pasar a Recolección" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(3);
  return page.url();
}

/** Answers every question of the open manager form (overall rating: lowest) and submits. */
async function fillAndSubmit(page: Page) {
  const boxes = page.getByRole("textbox", { name: /\?|\./ });
  await expect(boxes.first()).toBeVisible();
  for (let i = 0; i < (await boxes.count()); i++) {
    await boxes.nth(i).fill(`Respuesta ${i + 1}`);
    await boxes.nth(i).blur();
  }
  const groups = page.getByRole("radiogroup");
  const n = await groups.count();
  for (let i = 0; i < n; i++) {
    // Other ratings: 2; the overall rating (last): 1.
    await groups
      .nth(i)
      .getByRole("radio")
      .nth(i === n - 1 ? 0 : 1)
      .check();
  }
  await expect(page.getByText("Borrador guardado")).toBeVisible();
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(page.getByText(/Enviado el/)).toBeVisible();
}

test("HR calibrates by department, publishes, and the employee sees only the final rating", async ({
  page,
}) => {
  const name = `Calibración e2e ${Date.now()}`;
  test.setTimeout(120_000);
  const cycleUrl = await collectingCycle(page, name);
  const department = (
    await page
      .getByRole("row")
      .filter({ hasText: "Bruno Pérez" })
      .first()
      .getByRole("cell")
      .nth(2)
      .innerText()
  ).trim();

  // Carla submits her review of Bruno (overall rating: 1).
  await actAs(page, "Carla Romero", "Manager");
  await page.goto("/es/team");
  await page
    .getByRole("table", { name: "Reportes directos" })
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ hasText: "Bruno Pérez" })
    .getByRole("link", { name: "Evaluar" })
    .click();
  await fillAndSubmit(page);

  // HR shares every submitted review and opens calibration.
  await actAs(page, null, "People (RR. HH.)");
  await page.goto(cycleUrl);
  await page
    .getByRole("button", { name: "Compartir todas las evaluaciones enviadas" })
    .click();
  await expect(page.getByText(/Se comparti/)).toBeVisible();
  await page.getByRole("link", { name: "Calibración" }).click();
  await expect(page).toHaveURL(/\/calibration$/);

  // Group by department.
  await page.getByLabel("Nombre").fill(`Área ${department}`);
  await page.getByLabel("Tipo").selectOption({ label: "Por área" });
  await page.getByLabel("Criterio").selectOption({ label: department });
  await page.getByRole("button", { name: "Crear grupo" }).click();
  const row = page.getByRole("row").filter({ hasText: "Bruno Pérez" });
  await expect(row).toContainText("Necesita desarrollo");

  // Histogram before the change: Bruno counted at 1.
  const chart = page.getByRole("region", { name: "Distribución de ratings" });
  await expect(
    chart.getByRole("img", { name: new RegExp(`Necesita desarrollo 1`) }),
  ).toBeVisible();

  // Propose 3 with a reason.
  await row.getByRole("combobox").selectOption({ value: "3" });
  await row
    .getByPlaceholder("Motivo del cambio (obligatorio)")
    .fill("Impacto subestimado");
  await row.getByRole("button", { name: "Guardar cambio" }).click();
  await expect(row).toContainText("Impacto subestimado");
  await expect(
    chart.getByRole("img", { name: /Supera a menudo 1/ }),
  ).toBeVisible();

  // Publish.
  await page.getByRole("button", { name: "Publicar calibración" }).click();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText(/publicad/i).first()).toBeVisible();

  // Bruno sees only the final value.
  await page.goto("/es/me");
  await actAs(page, "Bruno Pérez", "Empleado");
  await page.goto(`${cycleUrl}/result`);
  await expect(page.getByTestId("final-rating")).toContainText(
    "3 · Supera a menudo",
  );
  await expect(page.getByText("Necesita desarrollo")).toHaveCount(0);
  await expect(page.getByText("Impacto subestimado")).toHaveCount(0);
});
