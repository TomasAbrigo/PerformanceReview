import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  byId,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

// The failed run these specs look at is made once by e2e/global-setup.ts.
const failedRun = process.env.E2E_RUN_FAILED ?? "";

// Ground truth from the generated company: active people with no manager (the
// CEO), as the "sin manager" indicator counts them.
const withoutManager = employees.filter(
  (e) => isActive(e) && e.managerId === null,
);
const casos = (n: number) => `${n} ${n === 1 ? "caso" : "casos"}`;

test("the panel flags the CEO without a manager and opens the case list", async ({
  page,
}) => {
  const ceo = find(
    withoutManager,
    (e) => hasUniqueName(e),
    "CEO with a unique name",
  );
  await page.goto("/es");
  await page.getByRole("link", { name: "Calidad de datos" }).click();

  await expect(page).toHaveURL(/\/es\/data-quality$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Calidad de datos" }),
  ).toBeVisible();

  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { level: 2, name: "Personas sin manager" }),
  });
  await expect(card.getByText(casos(withoutManager.length))).toBeVisible();
  await card.getByRole("link", { name: /Ver casos/ }).click();

  await expect(page).toHaveURL(/\/es\/data-quality\/no_manager$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Personas sin manager" }),
  ).toBeVisible();
  const rows = page.getByRole("row");
  await expect(rows).toHaveCount(withoutManager.length + 1); // + header
  const row = rows.filter({ hasText: fullName(ceo) });
  await expect(
    row.getByRole("link", { name: fullName(ceo), exact: true }),
  ).toHaveAttribute("href", /\/es\/people\/[0-9a-f-]{36}$/);
  // The top of the org has reports: not having a manager is expected, so it is badged.
  await expect(row.getByText("Tope")).toBeVisible();

  await page.getByRole("link", { name: "← Volver al panel" }).click();
  await expect(page).toHaveURL(/\/es\/data-quality$/);
});

test("the failed import of the setup shows up in the panel and links to the run", async ({
  page,
}) => {
  expect(failedRun, "E2E_RUN_FAILED is set by e2e/global-setup.ts").not.toBe(
    "",
  );
  await page.goto("/en/data-quality");
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", {
      level: 2,
      name: "Import runs in error (7 days)",
    }),
  });
  await expect(card).not.toContainText("No cases");
  await card.getByRole("link", { name: /View cases/ }).click();

  await expect(
    page.locator(`a[href$="/imports/runs/${failedRun}"]`),
  ).toBeVisible();
});

// Streamed behind a Suspense boundary: notFound() renders the not-found UI
// instead of a 404 status.
test("an unknown indicator renders the not-found page", async ({ page }) => {
  await page.goto("/es/data-quality/nope");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("the people list downloads its CSV: header and one row per person, with ids", async ({
  page,
}) => {
  const report = find(
    employees,
    (e) => isActive(e) && e.managerId !== null && hasUniqueName(e),
    "active person with a manager",
  );
  const manager = byId.get(report.managerId!)!;

  await page.goto("/es/people");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Exportar CSV" }).click();
  const file = await download;

  expect(file.suggestedFilename()).toBe("people.csv");
  const raw = await readFile(await file.path(), "utf8");
  // UTF-8 BOM so Excel reads the accents.
  expect(raw.charCodeAt(0)).toBe(0xfeff);
  const lines = raw.slice(1).split("\r\n");
  expect(lines.pop()).toBe(""); // every line, the last one too, ends in CRLF
  expect(lines[0]).toBe(
    "person_id,bamboo_id,legajo,email,nombre,estado,manager_id,manager,área,división,puesto,ubicación,fecha ingreso,fecha baja",
  );
  // The same people the screen lists: one per human.
  expect(lines).toHaveLength(employees.length + 1);
  const row = lines.find((l) => l.includes(`,${report.id},`))!;
  expect(row).toMatch(
    new RegExp(
      `^[0-9a-f-]{36},${report.id},${report.employeeNumber},${report.workEmail},`,
    ),
  );
  expect(row).toContain(fullName(report));
  expect(row).toContain(fullName(manager));
});

test("the JSON API pages through every person with ids and source ids, and 404s unknown ones", async ({
  request,
}) => {
  const first = await request.get("/api/v1/people?limit=10");
  expect(first.status()).toBe(200);
  const body = await first.json();
  expect(body.data).toHaveLength(10);
  expect(typeof body.next_cursor).toBe("string");
  expect(body.data[0]).toMatchObject({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    source: { system: expect.any(String), id: expect.any(String) },
  });

  // Walk every page: each person exactly once.
  const ids: string[] = body.data.map((p: { id: string }) => p.id);
  let cursor: string | null = body.next_cursor;
  while (cursor) {
    const page = await (
      await request.get(`/api/v1/people?limit=10&cursor=${cursor}`)
    ).json();
    ids.push(...page.data.map((p: { id: string }) => p.id));
    cursor = page.next_cursor;
  }
  expect(ids).toHaveLength(employees.length);
  expect(new Set(ids).size).toBe(employees.length);

  const missing = await request.get(
    "/api/v1/people/00000000-0000-4000-8000-000000000000",
  );
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toBe("application/problem+json");
  expect((await request.get("/api/v1/people?limit=0")).status()).toBe(400);
});
