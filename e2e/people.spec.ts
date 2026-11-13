import { expect, test } from "@playwright/test";
import { employees, find, fullName, hasUniqueName } from "./seed-data";

test.describe.configure({ mode: "serial" });

// The seed is the small generated company: one person per Bamboo record.
const everyone = employees.length;
const personas = (n: number) => `${n} ${n === 1 ? "persona" : "personas"}`;

test("people list shows every ingested person and searches", async ({
  page,
}) => {
  expect(everyone).toBe(40);
  await page.goto("/es/people");

  await expect(
    page.getByRole("heading", { level: 1, name: "Personas" }),
  ).toBeVisible();
  await expect(page.getByText(personas(everyone))).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(everyone + 1);

  // An ASCII last name: the search is case-insensitive, accents are not its concern.
  const query = find(
    employees,
    (e) => hasUniqueName(e) && /^[A-Za-z]+$/.test(e.lastName),
    "person with a plain last name",
  ).lastName.toLowerCase();
  const matches = employees.filter(
    (e) =>
      fullName(e).toLowerCase().includes(query) ||
      e.workEmail.toLowerCase().includes(query),
  );
  await page.getByRole("searchbox").fill(query);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(
    page.getByText(personas(matches.length), { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(matches.length + 1);
});

test("person detail shows source identities and employment", async ({
  page,
}) => {
  const ceo = find(
    employees,
    (e) => e.managerId === null && hasUniqueName(e),
    "CEO with a unique name",
  );
  await page.goto("/en/people");
  await page.getByRole("link", { name: fullName(ceo), exact: true }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: fullName(ceo) }),
  ).toBeVisible();
  const ids = page.getByRole("table", { name: "Source identifiers" });
  await expect(ids.getByText("Bamboo ID")).toBeVisible();
  await expect(ids.getByText(ceo.id, { exact: true })).toBeVisible();
  await expect(
    ids.getByText(ceo.employeeNumber, { exact: true }),
  ).toBeVisible();
  const periods = page.getByRole("table", { name: "Employment periods" });
  await expect(periods.getByText(ceo.hireDate)).toBeVisible();
});
