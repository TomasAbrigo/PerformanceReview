import { expect, test } from "@playwright/test";
import { employees, escapeRegExp, fullName, laterRehire } from "./seed-data";

// identity.setup.ts ran one more `pnpm ingest employee` over the seeded
// database: someone who left comes back under a new Bamboo id (same legajo and
// email). A rehire is never linked on its own, also when it shows up in a
// later run: it waits in the queue and nobody is created.
const { earlier, later } = laterRehire();
const name = fullName(later);

test("a rehire that arrives in a later run waits in the queue", async ({
  page,
}) => {
  await page.goto("/en/imports/identity");

  const row = page.getByRole("row", {
    name: new RegExp(`${escapeRegExp(name)}.*\\b${later.id}\\b`),
  });
  await expect(row.getByText("Possible match")).toBeVisible();
  await expect(row.getByText("1 candidate")).toBeVisible();

  await row.getByRole("link", { name }).click();
  const candidate = page.getByRole("listitem", { name });
  await expect(
    candidate.getByText(earlier.terminationDate!, { exact: false }),
  ).toBeVisible();
});

test("nobody was created for it: still one person per human", async ({
  page,
}) => {
  await page.goto("/en/people");

  await expect(page.getByText(`${employees.length} people`)).toBeVisible();
  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(1);
  await page.getByRole("link", { name, exact: true }).click();
  const ids = page.getByRole("table", { name: "Source identifiers" });
  await expect(ids.getByText(earlier.id, { exact: true })).toBeVisible();
  await expect(ids.getByText(later.id, { exact: true })).toHaveCount(0);
});
