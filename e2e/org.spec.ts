import { expect, test } from "@playwright/test";
import {
  company,
  employedOn,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
  jobRowsOf,
} from "./seed-data";

test.describe.configure({ mode: "serial" });

// An explicit date, so the specs do not depend on today's: the fictional
// "today" of the generated company.
const today = company.asOf;
const treeItems = (page: import("@playwright/test").Page) =>
  page.getByRole("treeitem");

test("the org chart has the CEO at the top and five levels", async ({
  page,
}) => {
  const ceo = find(employees, (e) => e.managerId === null, "CEO");
  await page.goto(`/es/org?date=${today}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Organigrama" }),
  ).toBeVisible();

  // One tree: every active employee under the one root.
  await expect(treeItems(page)).toHaveCount(employees.filter(isActive).length);
  const roots = page.getByRole("tree").locator(":scope > li");
  await expect(roots).toHaveCount(1);
  await expect(roots).toHaveAttribute("aria-label", fullName(ceo));

  const levels = await treeItems(page).evaluateAll((items) =>
    Math.max(
      ...items.map((item) => {
        let depth = 1;
        for (
          let up = item.parentElement?.closest('li[role="treeitem"]');
          up;
          up = up.parentElement?.closest('li[role="treeitem"]')
        ) {
          depth++;
        }
        return depth;
      }),
    ),
  );
  expect(levels).toBe(5);
});

test("the date picker travels back to who was in the org then", async ({
  page,
}) => {
  const early = find(employees, (e) => e.managerId === null, "CEO").hireDate;
  const middle = "2020-06-30";
  const expectedThen = employedOn(middle).length;
  expect(expectedThen).toBeGreaterThan(employedOn(early).length);
  expect(expectedThen).toBeLessThan(employees.filter(isActive).length);

  await page.goto(`/es/org?date=${early}`);
  await expect(treeItems(page)).toHaveCount(employedOn(early).length);

  await page.getByLabel("Fecha").fill(middle);
  await page.getByRole("button", { name: "Ver" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${middle}`));
  await expect(treeItems(page)).toHaveCount(expectedThen);

  // Before the company existed there is nobody.
  await page.goto("/es/org?date=1999-01-01");
  await expect(
    page.getByText("No hay nadie en la organización en esa fecha."),
  ).toBeVisible();
});

test("person detail shows the job history", async ({ page }) => {
  // Someone still here with the longest history (a unique name to click on).
  const mover = employees
    .filter((e) => isActive(e) && hasUniqueName(e))
    .sort((a, b) => jobRowsOf(b).length - jobRowsOf(a).length)[0];
  const rows = jobRowsOf(mover);
  expect(rows.length).toBeGreaterThan(2);

  await page.goto(`/en/org?date=${today}`);
  await page.getByRole("link", { name: fullName(mover), exact: true }).click();
  const history = page.getByRole("table", { name: "Job history" });
  await expect(history.getByRole("row")).toHaveCount(rows.length + 1);
  await expect(history.getByText("Current")).toBeVisible();
  await expect(history.getByText(mover.jobTitle).first()).toBeVisible();
});
