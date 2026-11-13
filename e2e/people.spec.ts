import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

// The DB is seeded once, before any spec, by the setup project (identity.setup.ts):
// the 3 hand-made Bamboo fixtures plus the identity spec's rehire case.

test("people list shows every ingested person and searches", async ({
  page,
}) => {
  await page.goto("/es/people");

  await expect(
    page.getByRole("heading", { level: 1, name: "Personas" }),
  ).toBeVisible();
  await expect(page.getByText("3 personas")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(4);

  await page.getByRole("searchbox").fill("carla");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/q=carla/);
  await expect(page.getByText("1 persona", { exact: true })).toBeVisible();
});

test("person detail shows source identities and employment", async ({
  page,
}) => {
  await page.goto("/en/people");
  await page.getByRole("link", { name: "Carla Romero" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Carla Romero" }),
  ).toBeVisible();
  const ids = page.getByRole("table", { name: "Source identifiers" });
  // A rehire linked by the identity spec adds a second Bamboo ID row.
  await expect(ids.getByText("Bamboo ID").first()).toBeVisible();
  await expect(ids.getByText("103", { exact: true })).toBeVisible();
  await expect(ids.getByText("0003")).toBeVisible();
  const periods = page.getByRole("table", { name: "Employment periods" });
  await expect(periods.getByText("2024-06-30")).toBeVisible();
});
