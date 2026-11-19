import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { countValue, showAllCards } from "./cards";
import { SCHEMA_MINOR } from "../src/modules/arturia-report/schema";
import { actAs, actAsRole } from "./act-as";
import { chooseCycle } from "./filters";
import { importFile } from "./upload";
import { assessedFirstCycle, company, fullName, records } from "./seed-data";

// The whole insights module end to end, as People would walk it: completion
// (with the period detail), indicators, qualitative, 360, monthly engagement,
// the executive view and the anonymized Arturía export. Runs in its own
// project after "insights": the historical import (chromium) already brought
// the reports in, so uploading them again here must change nothing.
test.describe.configure({ mode: "serial" });

const REPORTS = path.resolve("fixtures/bamboo-reports/small");
const ORG_FILE = path.resolve("fixtures/org/small/org-attributes.csv");
const ENGAGEMENT_FILE = path.resolve(
  "fixtures/engagement/small/engagement-monthly.csv",
);
const cycleName = company.cycles[0].name;

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? filesUnder(path.join(dir, e.name))
      : [path.join(dir, e.name)],
  );
}

/**
 * Uploads a file that is not a report of cycles (org attributes, monthly
 * engagement) as People would and waits for the run's page, which says what it
 * did. The same file again must change nothing: that is what is asserted, not
 * who brought the rows in first (a retry, or an earlier spec, may have).
 */
async function importPlainFile(page: Page, file: string, profile: string) {
  for (let pass = 0; pass < 2; pass++) {
    await page.goto("/es/imports/upload");
    await page.getByLabel("Archivo", { exact: true }).setInputFiles(file);
    await page.getByRole("button", { name: "Previsualizar" }).click();
    await expect(page.getByLabel("Perfil de fuente")).toHaveValue(profile);
    await page.getByRole("button", { name: "Importar" }).click();
    await expect(page).toHaveURL(/\/es\/imports\/runs\/[0-9a-f-]{36}$/, {
      timeout: 240_000,
    });
  }
  const counts = page.getByRole("group", { name: "Conteos" });
  for (const metric of ["Insertados", "Actualizados"]) {
    await expect(countValue(counts, metric)).toHaveText("0");
  }
}

test("People walk the whole insights module and export for Arturía", async ({
  page,
}) => {
  test.setTimeout(900_000);
  await page.goto("/es");
  await actAs(page, null, "People (RR. HH.)");

  // historical-import.spec.ts imported Bamboo's reports already (the raw
  // assessments report and the grouped Assessment Progress, as Bamboo gives
  // them): uploading them again changes nothing, and no cycle is created.
  for (const [file, profile] of [
    ["assessments-report.csv", "bamboo-assessments-report"],
    ["assessment-status.csv", "bamboo-assessment-status"],
  ]) {
    await importFile(page, path.join(REPORTS, file), profile);
    const cycles = page.getByRole("group", { name: "Ciclos detectados" });
    await expect(cycles.getByRole("article")).toHaveCount(
      company.cycles.length,
    );
    await expect(
      page.getByRole("heading", { name: "Hay filas esperando un ciclo" }),
    ).toHaveCount(0);
  }

  // People's org attributes file and the monthly engagement file, each
  // imported twice: the second time changes nothing.
  await importPlainFile(page, ORG_FILE, "org-attributes");
  await importPlainFile(page, ENGAGEMENT_FILE, "engagement-monthly");

  // Completion, with the period detail: one row per cycle, oldest first.
  await chooseCycle(page, "/es/insights/completion", cycleName);
  await expect(page.getByRole("group", { name: "Quién falta" })).toBeVisible();
  const periods = page.getByRole("group", { name: "Detalle por período" });
  await showAllCards(periods);
  // The legacy and the real-shape imports each left their cycles: at least one
  // card per cycle of the company, and the cycle chosen above is one of them.
  expect(await periods.getByRole("article").count()).toBeGreaterThan(
    company.cycles.length,
  );
  await expect(
    periods.getByRole("article", { name: cycleName, exact: true }),
  ).toBeVisible();
  await expect(
    periods.getByText("Valoración propia (1-4)").first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Detalle por período" })
      .getByRole("link", { name: "Exportar CSV" }),
  ).toHaveAttribute("href", /insights-period-detail\.csv/);

  await chooseCycle(page, "/es/insights/indicators", cycleName);
  await expect(
    page
      .getByRole("region", {
        name: "¿Qué grupos tienen las respuestas más bajas de retención?",
      })
      .getByTestId("indicator-histogram")
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", {
        name: "¿Cuántas personas tienen retención y compromiso bajos a la vez?",
      })
      .getByTestId("matrix-summary"),
  ).toBeVisible();

  // Qualitative: five sentiments, own and manager comments.
  await chooseCycle(page, "/es/insights/qualitative", cycleName);
  await page.getByRole("button", { name: "Correr análisis" }).click();
  await expect(page.getByRole("status")).toContainText("Proveedor: mock", {
    timeout: 60_000,
  });
  await expect(
    page
      .getByRole("group", {
        name: "Barras apiladas de sentimiento por dimensión",
      })
      .getByTestId("sentiment-bar")
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Leyenda de sentimientos" })
      .first()
      .getByRole("listitem"),
  ).toHaveText(["Positivo", "Constructivo", "Neutral", "Mixto", "Negativo"]);
  const side = page.getByRole("navigation", { name: "Quién escribe" });
  await side.getByRole("link", { name: "Propios" }).click();
  await expect(page).toHaveURL(/side=self/);
  await side.getByRole("link", { name: "Manager" }).click();
  await expect(page).toHaveURL(/side=manager/);

  // 360 by DM (the org attributes file is in).
  await chooseCycle(page, "/es/insights/360", cycleName);
  await expect(page.getByTestId("dm-card").first()).toBeVisible();

  // Monthly engagement: the evolution, the segments and the table by month.
  await page.goto("/es/insights/engagement");
  await expect(
    page.getByRole("heading", { level: 1, name: "Engagement mensual" }),
  ).toBeVisible();
  await expect(page.getByTestId("engagement-view")).toBeVisible();
  await expect(
    page.getByRole("group", { name: /Score promedio y participación por mes/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: /Personas por segmento y por mes/ }),
  ).toBeVisible();
  // The month table is open by default (#117); open it if a viewer closed it.
  const months = page.locator('table[aria-label="Detalle por mes"]');
  const monthsDetails = page.locator("details").filter({ has: months });
  if (!(await monthsDetails.evaluate((d) => (d as HTMLDetailsElement).open)))
    await monthsDetails.locator("summary").click();
  await expect(months).toBeVisible();
  expect(await months.getByRole("row").count()).toBeGreaterThan(6);

  // The executive view carries the latest month of it in the quantitative blocks.
  await chooseCycle(page, "/es/insights/executive", cycleName);
  const mode = page.getByRole("navigation", { name: "Modo" });
  await mode.getByRole("link", { name: "Cualitativo" }).click();
  await expect(page).toHaveURL(/mode=qualitative/);
  await expect(page.getByTestId("exec-sentiment")).toBeVisible();
  await mode.getByRole("link", { name: "Cuantitativo" }).click();
  await expect(page).toHaveURL(/mode=quantitative/);
  await expect(page.getByTestId("exec-retention")).toBeVisible();
  await expect(page.getByTestId("exec-engagement-monthly")).toContainText(
    "Último mes con datos",
  );

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
    // The engagement section is there (schema minor 4 and later) and says no person.
    const json = JSON.parse(
      readFileSync(
        files.find((f) => f.endsWith(".json"))!,
        "utf8",
      ),
    );
    expect(json.schemaMinor).toBe(SCHEMA_MINOR);
    expect(json.sections.engagementMonthly).toBeTruthy();
    expect(json.sections.people).toBeNull();
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
