import { expect, type Page, test } from "@playwright/test";
import {
  company,
  directReports,
  employees,
  find,
  fullName,
  hasUniqueName,
  isActive,
} from "./seed-data";

// Someone in the org on the snapshot day with no reports and a name the
// selectors can pick (same choice as the self assessment spec).
const employee = find(
  employees,
  (e) => isActive(e) && hasUniqueName(e) && directReports(e).length === 0,
  "person with no reports and a unique name",
);
const employeeName = fullName(employee);

/** Uses the header "Actuar como" selector. */
async function actAs(page: Page, person: string | null, role: string) {
  const bar = page.getByRole("form", { name: "Actuar como" });
  if (person) await bar.getByLabel("Buscar persona").fill(person);
  await bar
    .getByLabel("Persona", { exact: true })
    .selectOption({ label: person ?? "Sin persona" });
  await bar.getByLabel("Rol").selectOption({ label: role });
  await bar.getByRole("button", { name: "Aplicar" }).click();
  await expect(bar.getByText(/Actuando como:/)).toContainText(
    person ?? "People",
  );
}

/** Launches a cycle with everyone active and moves it to collecting. */
async function collectingCycle(page: Page, name: string): Promise<string> {
  await page.goto("/es/cycles/new");
  await expect(page.getByText("Paso 1 de 5")).toBeVisible();
  await page.getByLabel("Fecha de snapshot organizacional").fill(company.asOf);
  await expect(page.getByText(/\d+ personas coinciden/)).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  // Step 3 (template groups) is optional: skip it.
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Nombre del ciclo").fill(name);
  await page.getByLabel("Inicio del período").fill("2022-01-01");
  await page.getByLabel("Fin del período").fill("2022-06-30");
  await page.getByLabel("Autoevaluación").fill("2022-07-15");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Crear y lanzar" }).click();
  await expect(page).toHaveURL(/\/es\/cycles\/[0-9a-f-]{36}$/);
  const url = page.url();
  await page.getByRole("button", { name: "Pasar a Recolección" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByRole("table", { name: "Historial de estados" }).getByRole("row"),
  ).toHaveCount(3);
  return url;
}

/** RFC 4180 rows of a CSV (the BOM stripped). */
function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && body[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return rows;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

test("a submitted self review shows up in the review endpoints and the answers export", async ({
  page,
  request,
}) => {
  const name = `API de reviews e2e ${Date.now()}`;
  const cycleUrl = await collectingCycle(page, name);
  const cycleId = cycleUrl.split("/").pop()!;

  // The employee fills and submits their self assessment through the UI.
  await actAs(page, employeeName, "Empleado");
  await page.goto(cycleUrl + "/self");
  await expect(
    page.getByRole("heading", { level: 1, name: `Autoevaluación: ${name}` }),
  ).toBeVisible();
  const boxes = page.getByRole("textbox", { name: /\?|\./ });
  const answered = await boxes.count();
  expect(answered).toBeGreaterThan(0);
  for (let i = 0; i < answered; i++) {
    await boxes.nth(i).fill(`Respuesta ${i + 1}`);
    await boxes.nth(i).blur();
  }
  await expect(page.getByText("Borrador guardado")).toBeVisible();
  await page.getByRole("button", { name: "Enviar" }).click();
  await page.getByRole("button", { name: "Confirmar envío" }).click();
  await expect(page.getByText(/Enviado el/)).toBeVisible();

  // The cycle's self requests: one per participant, only theirs submitted.
  const list = await request.get(
    `/api/v1/cycles/${cycleId}/requests?relationship=self&limit=200`,
  );
  expect(list.status()).toBe(200);
  const requests = (await list.json()).data as Json[];
  expect(requests.length).toBeGreaterThan(1);
  const mine = requests.find((r) => r.reviewee.display_name === employeeName)!;
  expect(mine).toMatchObject({
    cycle_id: cycleId,
    relationship: "self",
    status: "submitted",
    reviewee: { source: { system: "bamboo_api", id: employee.id } },
    reviewer: { display_name: employeeName },
    reviewer_visible: true,
    shared_at: null,
    answer_count: answered,
  });
  // The participant's snapshot is the cycle's snapshot date.
  const cycleRes = await request.get(`/api/v1/cycles/${cycleId}`);
  expect(mine.participant.snapshot.as_of).toBe(
    (await cycleRes.json()).data.snapshot_date,
  );
  expect(mine.reviewer.id).toBe(mine.reviewee.id);
  expect(requests.filter((r) => r.status === "submitted")).toHaveLength(1);

  // Filters: submitted only.
  const submitted = await request.get(
    `/api/v1/cycles/${cycleId}/requests?status=submitted&relationship=self`,
  );
  expect((await submitted.json()).data.map((r: Json) => r.id)).toEqual([
    mine.id,
  ]);

  // The request and its answers.
  const detail = await request.get(`/api/v1/requests/${mine.id}`);
  expect(detail.status()).toBe(200);
  expect((await detail.json()).data).toMatchObject({
    id: mine.id,
    cycle: { id: cycleId, name, status: "collecting" },
  });
  const answersRes = await request.get(`/api/v1/requests/${mine.id}/answers`);
  expect(answersRes.status()).toBe(200);
  const answers = (await answersRes.json()).data as Json[];
  expect(answers).toHaveLength(answered);
  expect(answers.map((a) => a.text)).toEqual(
    Array.from({ length: answered }, (_, i) => `Respuesta ${i + 1}`),
  );
  for (const a of answers) {
    expect(a.request_id).toBe(mine.id);
    expect(a.question).toMatchObject({
      kind: "text",
      prompt: { es: expect.any(String), en: expect.any(String) },
    });
  }
  const revisions = await request.get(
    `/api/v1/cycles/${cycleId}/question-revisions?limit=200`,
  );
  const revisionIds = ((await revisions.json()).data as Json[]).map(
    (q) => q.id,
  );
  for (const a of answers) expect(revisionIds).toContain(a.question.id);

  // Read as the employee (same canRead as the screens): only their own request.
  const asEmployee = await request.get(
    `/api/v1/cycles/${cycleId}/requests?relationship=self&as_person=${mine.reviewee.id}&role=employee&limit=200`,
  );
  expect((await asEmployee.json()).data.map((r: Json) => r.id)).toEqual([
    mine.id,
  ]);

  // The answers export: one row per reviewer x question, ids on every row.
  const csv = await request.get(
    `/api/v1/export/answers.csv?cycle_id=${cycleId}&relationship=self`,
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(csv.headers()["content-disposition"]).toContain("answers.csv");
  const [header, ...rows] = parseCsv(await csv.text());
  expect(header).toContain("request_id");
  expect(header).toContain("pregunta (es)");
  expect(rows).toHaveLength(answered);
  const cell = (row: string[], column: string) => row[header.indexOf(column)];
  for (const [i, row] of rows.entries()) {
    expect(cell(row, "request_id")).toBe(mine.id);
    expect(cell(row, "cycle_id")).toBe(cycleId);
    expect(cell(row, "ciclo")).toBe(name);
    expect(cell(row, "person_id")).toBe(mine.reviewee.id);
    expect(cell(row, "bamboo_id")).toBe(employee.id);
    expect(cell(row, "nombre")).toBe(employeeName);
    expect(cell(row, "tipo")).toBe("self");
    expect(cell(row, "estado")).toBe("submitted");
    expect(cell(row, "evaluador")).toBe(employeeName);
    expect(cell(row, "evaluador visible")).toBe("true");
    expect(cell(row, "question_revision_id")).toBe(answers[i].question.id);
    expect(cell(row, "texto")).toBe(`Respuesta ${i + 1}`);
    expect(cell(row, "enviado")).toBe(mine.submitted_at);
  }

  // The English header carries the same columns.
  const en = await request.get(
    `/api/v1/export/answers.csv?cycle_id=${cycleId}&relationship=self&locale=en`,
  );
  const [enHeader, ...enRows] = parseCsv(await en.text());
  expect(enHeader).toHaveLength(header.length);
  expect(enHeader).toContain("answer_text");
  expect(enRows).toHaveLength(rows.length);

  // The requests export lists every request of the cycle, drafts included.
  const requestsCsv = await request.get(
    `/api/v1/export/requests.csv?cycle_id=${cycleId}&relationship=self&locale=en`,
  );
  const [reqHeader, ...reqRows] = parseCsv(await requestsCsv.text());
  expect(reqRows).toHaveLength(requests.length);
  const mineRow = reqRows.find(
    (r) => r[reqHeader.indexOf("request_id")] === mine.id,
  )!;
  expect(mineRow[reqHeader.indexOf("status")]).toBe("submitted");
  expect(mineRow[reqHeader.indexOf("answer_count")]).toBe(String(answered));

  // Unknown ids are problem+json 404s, bad filters 400s.
  const missing = await request.get(
    "/api/v1/requests/00000000-0000-4000-8000-000000000000",
  );
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toBe("application/problem+json");
  const bad = await request.get(
    `/api/v1/cycles/${cycleId}/requests?relationship=boss`,
  );
  expect(bad.status()).toBe(400);
});
