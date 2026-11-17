import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Runs `steps` on the "Actuar como" bar, clicks Aplicar and waits for the bar
 * to say `shown` (the cookie is set), retrying the whole sequence until it
 * does. The bar is a client component: on a slow or cold dev server the page
 * can be interactive before it has hydrated, and then what was typed or
 * selected is lost or the click submits nothing. Each attempt starts over, so
 * a late hydration only costs one more try.
 */
async function applyActor(
  page: Page,
  steps: (bar: Locator) => Promise<void>,
  shown: string,
) {
  const bar = page.getByRole("form", { name: "Actuar como" });
  await expect(async () => {
    await steps(bar);
    await bar
      .getByRole("button", { name: "Aplicar" })
      .click({ timeout: 4_000 });
    await expect(bar.getByText(/Actuando como:/)).toContainText(shown, {
      timeout: 4_000,
    });
  }).toPass({ timeout: 30_000 });
}

/**
 * Uses the header "Actuar como" selector: acts as `person` (null: no person,
 * i.e. the People team) with `role` (the label in the selector).
 */
export async function actAs(page: Page, person: string | null, role: string) {
  await applyActor(
    page,
    async (bar) => {
      if (person) {
        await bar.getByLabel("Buscar persona").fill(person, { timeout: 4_000 });
      }
      await bar
        .getByLabel("Persona", { exact: true })
        .selectOption({ label: person ?? "Sin persona" }, { timeout: 4_000 });
      await bar
        .getByLabel("Rol")
        .selectOption({ label: role }, { timeout: 4_000 });
    },
    person ?? "People",
  );
}

/**
 * Acts as a role without a person (enough for People-only gates and for
 * direction, which has none); waits for the bar to say `shown`, i.e. for the
 * cookie to be set.
 */
export async function actAsRole(page: Page, role: string, shown: string) {
  await applyActor(
    page,
    async (bar) => {
      await bar
        .getByLabel("Rol")
        .selectOption({ label: role }, { timeout: 4_000 });
    },
    shown,
  );
}
