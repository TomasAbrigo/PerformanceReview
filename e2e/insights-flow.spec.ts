import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { actAs, actAsRole } from "./act-as";
import { chooseCycle } from "./filters";
import { importFile } from "./upload";
import { assessedFirstCycle, company, fullName, records } from "./seed-data";

// The whole insights module end to end, as People would walk it. Runs in its
// own project after "insights": the historical import (chromium) already
// brought the reports in, so uploading them again here must change nothing.
test.describe.configure({ mode: "serial" });

const REPORTS = path.resolve("fixtures/bamboo-reports/small");
const cycleName = company.cycles[0].name;

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesUnder(path.join(dir, e.name))
      : [path.join(dir, e.name)],
  );
}

test("People upload the reports, read every insight and export for Arturía", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");

  // historical-import.spec.ts imported them already: nothing new.
  for (const [file, profile] of [
    ["employee-performance.csv", "bamboo-employee-performance"],
    ["assessment-progress.csv", "bamboo-assessment-progress"],
  ]) {
    await importFile(page, path.join(REPORTS, file), profile);
    const cycles = page.getByRole("table", { name: "Ciclos detectados" });
    await expect(cycles.getByRole("row")).toHaveCount(
      1 + company.cycles.length,
    );
    await expect(
      cycles.getByRole("cell", { name: /^0 nuevas/ }).first(),
    ).toBeVisible();
    await expect(
      cycles.getByRole("cell", { name: /^[1-9]\d* nuevas/ }),
    ).toHaveCount(0);
  }

  await chooseCycle(page, "/es/insights/completion", cycleName);
  await expect(page.getByRole("table", { name: "Quién falta" })).toBeVisible();

  await chooseCycle(page, "/es/insights/indicators", cycleName);
  await expect(
    page
      .getByRole("region", { name: "Distribución de Retención" })
      .getByTestId("indicator-histogram")
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Matriz de retención y compromiso" })
      .getByTestId("matrix-summary"),
  ).toBeVisible();

  await chooseCycle(page, "/es/insights/qualitative", cycleName);
  await page.getByRole("button", { name: "Correr análisis" }).click();
  await expect(page.getByRole("status")).toContainText("Proveedor: mock", {
    timeout: 60_000,
  });
  await expect(
    page
      .getByRole("img", {
        name: "Barras apiladas de sentimiento por dimensión",
      })
      .getByTestId("sentiment-bar")
      .first(),
  ).toBeVisible();

  await chooseCycle(page, "/es/insights/executive", cycleName);
  const mode = page.getByRole("navigation", { name: "Modo" });
  await mode.getByRole("link", { name: "Cualitativo" }).click();
  await expect(page).toHaveURL(/mode=qualitative/);
  await expect(page.getByTestId("exec-sentiment")).toBeVisible();
  await mode.getByRole("link", { name: "Cuantitativo" }).click();
  await expect(page).toHaveURL(/mode=quantitative/);
  await expect(page.getByTestId("exec-retention")).toBeVisible();

  // The anonymized export: no email, no person's name, no external URL.
  const out = mkdtempSync(path.join(tmpdir(), "e2e-arturia-"));
  try {
    execFileSync(
      "pnpm",
      ["export:arturia", "--cycle", "latest", "--anonymized", "--out", out],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    );
    const files = filesUnder(out).filter((f) => /\.(html|json)$/.test(f));
    expect(files.some((f) => f.endsWith(".html"))).toBe(true);
    expect(files.some((f) => f.endsWith(".json"))).toBe(true);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(text, file).not.toMatch(/(src|href)=["']?(https?:)?\/\//i);
      expect(text, file).not.toMatch(/url\(\s*["']?(https?:)?\/\//i);
      for (const r of records) {
        expect(text.includes(fullName(r)), `${file}: a seed name`).toBe(false);
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("direction sees the executive view masked", async ({ page }) => {
  await page.goto("/es");
  await actAsRole(page, "Dirección", "Dirección");
  await page.goto("/es/insights/executive?mode=both");
  await expect(
    page.getByText(/grupos de menos de \d+ personas/).first(),
  ).toBeVisible();
});

test("an employee cannot read the indicators", async ({ page }) => {
  await page.goto("/es");
  await actAs(page, fullName(assessedFirstCycle), "Empleado");
  await page.goto("/es/insights/indicators");
  await expect(
    page.getByText("No tenés acceso a estos indicadores."),
  ).toBeVisible();
});
