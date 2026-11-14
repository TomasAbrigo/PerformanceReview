import { expect, test } from "@playwright/test";
import {
  escapeRegExp,
  find,
  fullName,
  hasUniqueName,
  recordById,
  rehires,
} from "./seed-data";

// The rehire cases are in the queue since the seed (e2e/global-setup.ts): a
// person who left comes back under a new Bamboo id with the same legajo and
// email. This spec links one, so it runs after every spec that only reads.
test.describe.configure({ mode: "serial" });

const rehire = find(
  rehires.map((r) => ({
    earlier: recordById.get(r.earlier)!,
    later: recordById.get(r.later[0])!,
  })),
  (r) =>
    r.earlier.terminationDate !== null &&
    r.earlier.workEmail === r.later.workEmail &&
    hasUniqueName(r.earlier),
  "rehire with the same legajo and email, and a unique name",
);
const name = fullName(rehire.later);
const queueRow = new RegExp(`${escapeRegExp(name)}.*\\b${rehire.later.id}\\b`);

test("the queue holds the ambiguous row and suggests the person", async ({
  page,
}) => {
  await page.goto("/es/imports/identity");

  await expect(
    page.getByRole("heading", { level: 1, name: "Cola de identidad" }),
  ).toBeVisible();

  await page.goto("/en/imports/identity");
  const row = page.getByRole("row", { name: queueRow });
  await expect(row.getByText("Possible match")).toBeVisible();
  await expect(row.getByText("1 candidate")).toBeVisible();

  await row.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const candidate = page.getByRole("listitem", { name });
  await expect(candidate.getByText("Employee number")).toBeVisible();
  await expect(candidate.getByText("Email", { exact: true })).toBeVisible();
  await expect(
    candidate.getByText(rehire.earlier.terminationDate!, { exact: false }),
  ).toBeVisible();
});

test("linking the case adds the new employment to the same person", async ({
  page,
}) => {
  await page.goto("/en/imports/identity");
  await page
    .getByRole("row", { name: queueRow })
    .getByRole("link", { name })
    .click();

  await page.getByLabel("Note (optional)").fill("Rehire, same person");
  await page.getByRole("button", { name: `Link to ${name}` }).click();

  await expect(page).toHaveURL(/\/en\/imports\/identity$/);
  await expect(page.getByRole("row", { name: queueRow })).toHaveCount(0);

  await page.getByRole("link", { name: "History" }).click();
  const done = page.getByRole("row", { name: queueRow });
  await expect(done.getByText("Linked")).toBeVisible();

  await page.goto("/en/people");
  await page.getByRole("link", { name, exact: true }).click();
  const periods = page.getByRole("table", { name: "Employment periods" });
  await expect(periods.getByRole("row")).toHaveCount(3);
  await expect(
    periods.getByText(rehire.earlier.terminationDate!),
  ).toBeVisible();
  await expect(periods.getByText(rehire.later.hireDate)).toBeVisible();
  const ids = page.getByRole("table", { name: "Source identifiers" });
  await expect(ids.getByText(rehire.earlier.id, { exact: true })).toBeVisible();
  await expect(ids.getByText(rehire.later.id, { exact: true })).toBeVisible();
});
