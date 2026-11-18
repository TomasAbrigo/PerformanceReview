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
    if (!(await bar.isVisible())) await page.locator(".actor-trigger").click();
    await steps(bar);
    await bar
      .getByRole("button", { name: "Aplicar" })
      .click({ timeout: 4_000 });
    await expect(page.locator(".actor-trigger")).toContainText(shown, {
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

/** The cookie the "Actuar como" selector's action sets (src/modules/actor/types.ts). */
const ACTOR_COOKIE = "pr_actor";

/**
 * Acts as `personId` with `role` by setting the cookie the selector's server
 * action sets, without going through the header selector. For specs whose
 * subject is not the selector: that one is a client component and, on a slow
 * dev server, hydrates late (see `applyActor`), which makes any spec that
 * leans on it flaky under load. Null person with `hr` is the default actor.
 */
export async function actAsCookie(
  page: Page,
  actor: {
    personId: string | null;
    role: "hr" | "manager" | "employee" | "direction";
  },
) {
  const port = process.env.E2E_PORT ?? 3100;
  await page.context().addCookies([
    {
      name: ACTOR_COOKIE,
      value: encodeURIComponent(JSON.stringify(actor)),
      url: `http://localhost:${port}`,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
