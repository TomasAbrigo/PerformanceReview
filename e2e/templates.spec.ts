import { expect, test } from "@playwright/test";

test("clones a system template and adds a question in both languages", async ({
  page,
}) => {
  await page.goto("/es/settings/templates");
  await expect(
    page.getByRole("heading", { level: 1, name: "Templates de evaluación" }),
  ).toBeVisible();

  const row = page.getByRole("row").filter({
    has: page.getByRole("link", { name: "Feedback de pares", exact: true }),
  });
  await row.getByRole("button", { name: "Clonar template" }).click();

  // The clone opens in the editor, editable and with the copied questions.
  await expect(page).toHaveURL(/\/es\/settings\/templates\/[0-9a-f-]{36}$/);
  await expect(
    page.getByText("¿Cuáles son las mayores fortalezas de esta persona?"),
  ).toBeVisible();

  const name = `Pares e2e ${Date.now()}`;
  const nameForm = page.getByRole("form", { name: "Guardar nombre" });
  await nameForm.getByLabel("Nombre (español)").fill(name);
  await nameForm.getByLabel("Nombre (inglés)").fill(`Peers e2e ${Date.now()}`);
  await nameForm.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const form = page.getByRole("form", { name: "Nueva pregunta" });
  await form
    .getByLabel("Texto (español)")
    .fill("¿Qué debería empezar a hacer?");
  await form.getByRole("button", { name: "Agregar pregunta" }).click();
  await expect(form.getByText("Falta el texto en inglés.")).toBeVisible();

  await form.getByLabel("Texto (inglés)").fill("What should they start doing?");
  await form.getByLabel("Par", { exact: true }).check();
  await form.getByRole("button", { name: "Agregar pregunta" }).click();
  await expect(page.getByText("¿Qué debería empezar a hacer?")).toBeVisible();

  // Same template in English shows the English text.
  await page.goto(page.url().replace("/es/", "/en/"));
  await expect(page.getByText("What should they start doing?")).toBeVisible();
});
