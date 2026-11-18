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

  const row = page.getByRole("article").filter({
    hasText: new RegExp(`${escapeRegExp(name)}.*\\b${later.id}\\b`),
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
  request,
}) => {
  // One row per person in the export (+ header, + the empty tail).
  const csv = await (await request.get("/api/v1/export/people.csv")).text();
  expect(csv.slice(1).split("\r\n")).toHaveLength(employees.length + 2);

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
  const ids = detail.source_identities.map((i: { value: string }) => i.value);
  expect(ids).toContain(earlier.id);
  expect(ids).not.toContain(later.id);
});
