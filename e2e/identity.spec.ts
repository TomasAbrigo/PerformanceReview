import { expect, test } from "@playwright/test";

// The rehire case (Carla, id 201) is queued by identity.setup.ts, right before this spec.
test.describe.configure({ mode: "serial" });

test("the queue holds the ambiguous row and suggests the person", async ({
  page,
}) => {
  await page.goto("/es/imports/identity");

  await expect(
    page.getByRole("heading", { level: 1, name: "Cola de identidad" }),
  ).toBeVisible();

  await page.goto("/en/imports/identity");
  const row = page.getByRole("row", { name: /Carla Romero.*201/ });
  await expect(row.getByText("Possible match")).toBeVisible();
  await expect(row.getByText("1 candidate")).toBeVisible();

  await row.getByRole("link", { name: "Carla Romero" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Carla Romero" }),
  ).toBeVisible();
  const candidate = page.getByRole("listitem", { name: "Carla Romero" });
  await expect(candidate.getByText("Employee number")).toBeVisible();
  await expect(candidate.getByText("Email", { exact: true })).toBeVisible();
  await expect(
    candidate.getByText("2024-06-30", { exact: false }),
  ).toBeVisible();
});

test("linking the case adds the new employment to the same person", async ({
  page,
}) => {
  await page.goto("/en/imports/identity");
  await page
    .getByRole("row", { name: /Carla Romero.*201/ })
    .getByRole("link", { name: "Carla Romero" })
    .click();

  await page.getByLabel("Note (optional)").fill("Rehire, same person");
  await page.getByRole("button", { name: "Link to Carla Romero" }).click();

  await expect(page).toHaveURL(/\/en\/imports\/identity$/);
  await expect(
    page.getByRole("row", { name: /Carla Romero.*201/ }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "History" }).click();
  const done = page.getByRole("row", { name: /Carla Romero.*201/ });
  await expect(done.getByText("Linked")).toBeVisible();

  await page.goto("/en/people");
  await page.getByRole("link", { name: "Carla Romero" }).click();
  const periods = page.getByRole("table", { name: "Employment periods" });
  await expect(periods.getByRole("row")).toHaveCount(3);
  await expect(periods.getByText("2024-06-30")).toBeVisible();
  await expect(periods.getByText("2025-03-01")).toBeVisible();
  const ids = page.getByRole("table", { name: "Source identifiers" });
  await expect(ids.getByText("103", { exact: true })).toBeVisible();
  await expect(ids.getByText("201", { exact: true })).toBeVisible();
});
