import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// The failed run these specs look at is made once by e2e/global-setup.ts.
const failedRun = process.env.E2E_RUN_FAILED ?? "";

test("the panel flags the CEO without a manager and opens the case list", async ({
  page,
}) => {
  await page.goto("/es");
  await page.getByRole("link", { name: "Calidad de datos" }).click();

  await expect(page).toHaveURL(/\/es\/data-quality$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Calidad de datos" }),
  ).toBeVisible();

  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { level: 2, name: "Personas sin manager" }),
  });
  await expect(card.getByText("1 caso")).toBeVisible();
  await card.getByRole("link", { name: /Ver casos/ }).click();

  await expect(page).toHaveURL(/\/es\/data-quality\/no_manager$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Personas sin manager" }),
  ).toBeVisible();
  const rows = page.getByRole("row");
  await expect(rows).toHaveCount(2); // header + Ana
  const ana = rows.filter({ hasText: "Ana García" });
  await expect(ana.getByRole("link", { name: "Ana García" })).toHaveAttribute(
    "href",
    /\/es\/people\/[0-9a-f-]{36}$/,
  );
  // She is the top of the org: expected, so it is badged.
  await expect(ana.getByText("Tope")).toBeVisible();

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
  expect(lines).toHaveLength(4); // header + Ana, Bruno, Carla
  const bruno = lines.find((l) => l.includes("Bruno Pérez"))!;
  expect(bruno).toMatch(/^[0-9a-f-]{36},102,0002,bruno\.perez@example\.com,/);
  expect(bruno).toContain(",Ana García,");
});

test("the JSON API serves people with ids and source ids, and 404s unknown ones", async ({
  request,
}) => {
  const list = await request.get("/api/v1/people?limit=2");
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(body.data).toHaveLength(2);
  expect(typeof body.next_cursor).toBe("string");
  expect(body.data[0]).toMatchObject({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    source: { system: "bamboo_api", id: expect.any(String) },
  });

  const next = await request.get(
    `/api/v1/people?limit=2&cursor=${body.next_cursor}`,
  );
  expect((await next.json()).data).toHaveLength(1);

  const missing = await request.get(
    "/api/v1/people/00000000-0000-4000-8000-000000000000",
  );
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toBe("application/problem+json");
  expect((await request.get("/api/v1/people?limit=0")).status()).toBe(400);
});
