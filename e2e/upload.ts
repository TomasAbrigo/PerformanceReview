import { expect, type Page } from "@playwright/test";

/**
 * Uploads `file` in /es/imports/upload, checks the profile detected is
 * `profile` and imports it; waits for the history page of the run.
 */
export async function importFile(page: Page, file: string, profile: string) {
  await page.goto("/es/imports/upload");
  await page.getByLabel("Archivo", { exact: true }).setInputFiles(file);
  await page.getByRole("button", { name: "Previsualizar" }).click();
  await expect(page.getByLabel("Perfil de fuente")).toHaveValue(profile);
  await page.getByRole("button", { name: "Importar" }).click();
  await expect(page).toHaveURL(/\/es\/imports\/history\/[0-9a-f-]{36}$/, {
    timeout: 240_000,
  });
}
