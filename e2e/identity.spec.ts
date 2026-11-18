import { expect, test } from "@playwright/test";
import { actAsRole } from "./act-as";
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
  const row = page.getByRole("article").filter({ hasText: queueRow });
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

test("the candidate's email is shown to People only", async ({ page }) => {
  // In Spanish: the "Actuar como" bar helpers use its Spanish labels.
  await page.goto("/es/imports/identity");
  await page
    .getByRole("article")
    .filter({ hasText: queueRow })
    .getByRole("link", { name })
    .click();
  const candidate = page.getByRole("listitem", { name });
  await expect(
    candidate.getByText(rehire.earlier.workEmail, { exact: true }),
  ).toBeVisible();

  // The default actor is People (hr). Anyone else gets no access, and no email.
  await actAsRole(page, "Empleado", "Sin persona");
  await expect(page.getByTestId("no-access")).toBeVisible();
  await expect(page.getByText(rehire.earlier.workEmail)).toHaveCount(0);
  await expect(page.getByText(/@/)).toHaveCount(0);
});

test("linking the case adds the new employment to the same person", async ({
  page,
}) => {
  await page.goto("/en/imports/identity");
  await page
    .getByRole("article")
    .filter({ hasText: queueRow })
    .getByRole("link", { name })
    .click();

  await page.getByLabel("Note (optional)").fill("Rehire, same person");
  await page.getByRole("button", { name: `Link to ${name}` }).click();

  await expect(page).toHaveURL(/\/en\/imports\/identity$/);
  await expect(
    page.getByRole("article").filter({ hasText: queueRow }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "History" }).click();
  const done = page.getByRole("row", { name: queueRow });
  await expect(done.getByText("Linked")).toBeVisible();
});

test("the linked person has both employments and both Bamboo ids", async ({
  request,
}) => {
  const found = await request.get(
    `/api/v1/people?q=${encodeURIComponent(name)}&limit=10`,
  );
  const people: { id: string; display_name: string }[] = (await found.json())
    .data;
  const named = people.filter((p) => p.display_name === name);
  expect(named).toHaveLength(1);

  const detail = (
    await (await request.get(`/api/v1/people/${named[0].id}`)).json()
  ).data;
  const hires = detail.employments.map(
    (e: { hire_date: string }) => e.hire_date,
  );
  expect(detail.employments).toHaveLength(2);
  expect(hires).toContain(rehire.earlier.hireDate);
  expect(hires).toContain(rehire.later.hireDate);
  const ids = detail.source_identities.map((i: { value: string }) => i.value);
  expect(ids).toContain(rehire.earlier.id);
  expect(ids).toContain(rehire.later.id);
});
