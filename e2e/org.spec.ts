import { expect, test } from "@playwright/test";
import { addDays } from "../src/modules/org-history/build";
import {
  byId,
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

/**
 * Someone who changed manager, and the two managers around the change. Bamboo
 * only has the manager's NAME ("Last, First") in the past rows, so the old
 * hierarchy shows only when the ingest matches it to the "First Last" person:
 * everyone here has a name of their own, or the match is (rightly) refused.
 */
function managerChange() {
  for (const person of employees.filter(hasUniqueName)) {
    const rows = jobRowsOf(person).sort((a, b) => a.date.localeCompare(b.date));
    for (const [i, row] of rows.entries()) {
      const previous = rows[i - 1];
      if (!previous?.managerId || !row.managerId) continue;
      if (previous.managerId === row.managerId) continue;
      if (previous.date >= row.date) continue;
      const oldManager = byId.get(previous.managerId);
      const newManager = byId.get(row.managerId);
      if (!oldManager || !newManager) continue;
      if (!hasUniqueName(oldManager) || !hasUniqueName(newManager)) continue;
      const before = addDays(row.date, -1);
      const employedBefore = employedOn(before);
      const employedThen = employedOn(row.date);
      if (
        employedBefore.includes(person) &&
        employedBefore.includes(oldManager) &&
        employedThen.includes(person) &&
        employedThen.includes(newManager)
      ) {
        return { person, oldManager, newManager, before, changedOn: row.date };
      }
    }
  }
  throw new Error("the small fixture has no usable manager change");
}

test("the org chart at a past date shows the old hierarchy of someone who changed manager", async ({
  page,
}) => {
  const { person, oldManager, newManager, before, changedOn } = managerChange();
  // The nearest enclosing tree item of `name`: who they report to in the chart.
  const reportsTo = (name: string) =>
    page
      .getByRole("treeitem", { name, exact: true })
      .locator("xpath=ancestor::li[@role='treeitem'][1]");

  // The day before the change: under the old manager.
  await page.goto(`/es/org?date=${before}`);
  await expect(reportsTo(fullName(person))).toHaveAttribute(
    "aria-label",
    fullName(oldManager),
  );

  // The day of the change: under the new one.
  await page.goto(`/es/org?date=${changedOn}`);
  await expect(reportsTo(fullName(person))).toHaveAttribute(
    "aria-label",
    fullName(newManager),
  );
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
