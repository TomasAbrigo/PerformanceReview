import { expect, type Page, test } from "@playwright/test";

// Acts as a role without a person (enough for the People-only gates); waits
// for the bar to say so, i.e. for the cookie to be set.
async function actAsRole(page: Page, role: string, shown: string) {
  const bar = page.getByRole("form", { name: "Actuar como" });
  await bar.getByLabel("Rol").selectOption({ label: role });
  await bar.getByRole("button", { name: "Aplicar" }).click();
  await expect(bar.getByText(/Actuando como:/)).toContainText(shown);
}

test("People edit the insights settings, the server validates, and the change sticks", async ({
  page,
}) => {
  await page.goto("/es/settings/insights");
  await expect(
    page.getByRole("heading", { name: "Configuración de insights" }),
  ).toBeVisible();
  const min = page.getByLabel("Tamaño mínimo de grupo (n)");
  const original = await min.inputValue();
  const changed = original === "7" ? "6" : "7";

  // The server rejects a value that is not a day, and an H1 after the H2.
  await page.getByLabel("Inicio del primer semestre (MM-DD)").fill("13-01");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByText("Ingresá un día válido con formato MM-DD."),
  ).toBeVisible();
  await page.getByLabel("Inicio del primer semestre (MM-DD)").fill("08-01");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByText(
      "El segundo semestre tiene que empezar después del primero.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Cambios guardados.")).toHaveCount(0);

  // A valid change is saved and survives a reload.
  await page.getByLabel("Inicio del primer semestre (MM-DD)").fill("01-01");
  await min.fill(changed);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Tamaño mínimo de grupo (n)")).toHaveValue(
    changed,
  );

  // Put it back for the other specs.
  await page.getByLabel("Tamaño mínimo de grupo (n)").fill(original);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados.")).toBeVisible();
});

const peopleOnly = [
  ["/es/settings/insights", /Configuración de insights/],
  ["/es/settings/scales", /Escalas de rating/],
  ["/es/imports/upload", /Subir archivo/],
  ["/es/imports/runs", /Corridas de importación/],
  ["/es/imports/identity", /Cola de identidad/],
  ["/es/data-quality", /Calidad de datos/],
] as const;

for (const [role, shown] of [
  ["Manager", "Sin persona"],
  ["Empleado", "Sin persona"],
  ["Dirección", "Dirección"],
] as const) {
  test(`${role} gets "Sin acceso" on the People-only screens`, async ({
    page,
  }) => {
    await page.goto("/es");
    await actAsRole(page, role, shown);
    for (const [url] of peopleOnly) {
      await page.goto(url);
      await expect(
        page.getByRole("heading", { name: "Sin acceso" }),
        url,
      ).toBeVisible();
    }
  });
}

test("People reach the People-only screens", async ({ page }) => {
  for (const [url, heading] of peopleOnly) {
    await page.goto(url);
    await expect(
      page.getByRole("heading", { name: heading }).first(),
      url,
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sin acceso" })).toHaveCount(
      0,
    );
  }
});

test("direction lands on the leadership view from /dashboards", async ({
  page,
}) => {
  await page.goto("/es");
  await actAsRole(page, "Dirección", "Dirección");
  await page.goto("/es/dashboards");
  await expect(page).toHaveURL(/\/es\/dashboards\/executive/);
});
