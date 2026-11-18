import { expect, test } from "@playwright/test";
import { actAsRole } from "./act-as";

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
  await page.getByLabel("Inicio del primer semestre (MM-DD)").fill("10-01");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(
    page.getByText(
      "El segundo semestre tiene que empezar después del primero.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Cambios guardados.")).toHaveCount(0);

  // A valid change is saved and survives a reload.
  await page.getByLabel("Inicio del primer semestre (MM-DD)").fill("03-29");
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
