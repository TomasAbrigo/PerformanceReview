import { expect, type Page } from "@playwright/test";

/**
 * Uses the header "Actuar como" selector: acts as `person` (null: no person,
 * i.e. the People team) with `role` (the label in the selector).
 */
export async function actAs(page: Page, person: string | null, role: string) {
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

/**
 * Acts as a role without a person (enough for People-only gates and for
 * direction, which has none); waits for the bar to say `shown`, i.e. for the
 * cookie to be set.
 */
export async function actAsRole(page: Page, role: string, shown: string) {
  const bar = page.getByRole("form", { name: "Actuar como" });
  await bar.getByLabel("Rol").selectOption({ label: role });
  await bar.getByRole("button", { name: "Aplicar" }).click();
  await expect(bar.getByText(/Actuando como:/)).toContainText(shown);
}
