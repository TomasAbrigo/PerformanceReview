import { expect, type APIRequestContext, test } from "@playwright/test";
import { assessed2023, company, fullName } from "./seed-data";

// Runs after the historical import (project "insights" depends on
// "chromium", where e2e/historical-import.spec.ts imports the Employee
// Performance report): the review data comes from that import.
const employeeName = fullName(assessed2023);
const cycleName = company.cycles[0].name;

/** Id of the imported cycle named `name` (GET /api/v1/cycles). */
async function cycleIdOf(request: APIRequestContext, name: string) {
  const res = await request.get("/api/v1/cycles?limit=200");
  expect(res.status()).toBe(200);
  const cycle = ((await res.json()).data as Json[]).find(
    (c) => c.name === name,
  );
  expect(cycle).toBeDefined();
  return cycle!.id as string;
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

test("an imported self review shows up in the review endpoints and the answers export", async ({
  request,
}) => {
  const cycleId = await cycleIdOf(request, cycleName);

  // The cycle's self requests: the imported, submitted self review is there.
  const list = await request.get(
    `/api/v1/cycles/${cycleId}/requests?relationship=self&limit=200`,
  );
  expect(list.status()).toBe(200);
  const requests = (await list.json()).data as Json[];
  expect(requests.length).toBeGreaterThan(1);
  const mine = requests.find((r) => r.reviewee.source?.id === assessed2023.id)!;
  expect(mine).toMatchObject({
    cycle_id: cycleId,
    relationship: "self",
    status: "submitted",
    reviewee: { display_name: employeeName },
    reviewer: { display_name: employeeName },
    reviewer_visible: true,
    source: { system: "bamboo_export" },
  });
  expect(mine.answer_count).toBeGreaterThan(0);
  expect(mine.reviewer.id).toBe(mine.reviewee.id);
  // The participant's snapshot is the cycle's snapshot date.
  const cycleRes = await request.get(`/api/v1/cycles/${cycleId}`);
  const cycle = (await cycleRes.json()).data;
  expect(cycle).toMatchObject({ name: cycleName, status: "closed" });
  expect(mine.participant.snapshot.as_of).toBe(cycle.snapshot_date);

  // Filters: submitted only.
  const submitted = await request.get(
    `/api/v1/cycles/${cycleId}/requests?status=submitted&relationship=self&limit=200`,
  );
  expect((await submitted.json()).data.map((r: Json) => r.id)).toContain(
    mine.id,
  );

  // The request and its answers.
  const detail = await request.get(`/api/v1/requests/${mine.id}`);
  expect(detail.status()).toBe(200);
  expect((await detail.json()).data).toMatchObject({
    id: mine.id,
    cycle: { id: cycleId, name: cycleName, status: "closed" },
  });
  const answersRes = await request.get(`/api/v1/requests/${mine.id}/answers`);
  expect(answersRes.status()).toBe(200);
  const answers = (await answersRes.json()).data as Json[];
  expect(answers).toHaveLength(mine.answer_count);
  const revisions = await request.get(
    `/api/v1/cycles/${cycleId}/question-revisions?limit=200`,
  );
  const revisionIds = ((await revisions.json()).data as Json[]).map(
    (q) => q.id,
  );
  for (const a of answers) {
    expect(a.request_id).toBe(mine.id);
    expect(revisionIds).toContain(a.question.id);
  }

  // Read as the employee (same canRead as the screens): only their own request.
  const asEmployee = await request.get(
    `/api/v1/cycles/${cycleId}/requests?relationship=self&as_person=${mine.reviewee.id}&role=employee&limit=200`,
  );
  expect((await asEmployee.json()).data.map((r: Json) => r.id)).toEqual([
    mine.id,
  ]);

  // The answers export: one row per answer, ids on every row.
  const csv = await request.get(
    `/api/v1/export/answers.csv?cycle_id=${cycleId}&relationship=self&as_person=${mine.reviewee.id}&role=employee`,
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(csv.headers()["content-disposition"]).toContain("answers.csv");
  const [header, ...rows] = parseCsv(await csv.text());
  expect(header).toContain("request_id");
  expect(header).toContain("pregunta (es)");
  expect(rows).toHaveLength(answers.length);
  const cell = (row: string[], column: string) => row[header.indexOf(column)];
  for (const row of rows) {
    expect(cell(row, "request_id")).toBe(mine.id);
    expect(cell(row, "cycle_id")).toBe(cycleId);
    expect(cell(row, "ciclo")).toBe(cycleName);
    expect(cell(row, "person_id")).toBe(mine.reviewee.id);
    expect(cell(row, "bamboo_id")).toBe(assessed2023.id);
    expect(cell(row, "nombre")).toBe(employeeName);
    expect(cell(row, "tipo")).toBe("self");
    expect(cell(row, "estado")).toBe("submitted");
    expect(cell(row, "evaluador")).toBe(employeeName);
    expect(answers.map((a) => a.question.id)).toContain(
      cell(row, "question_revision_id"),
    );
  }

  // The English header carries the same columns.
  const en = await request.get(
    `/api/v1/export/answers.csv?cycle_id=${cycleId}&relationship=self&as_person=${mine.reviewee.id}&role=employee&locale=en`,
  );
  const [enHeader, ...enRows] = parseCsv(await en.text());
  expect(enHeader).toHaveLength(header.length);
  expect(enHeader).toContain("answer_text");
  expect(enRows).toHaveLength(rows.length);

  // The requests export lists every self request of the cycle.
  const requestsCsv = await request.get(
    `/api/v1/export/requests.csv?cycle_id=${cycleId}&relationship=self&locale=en`,
  );
  const [reqHeader, ...reqRows] = parseCsv(await requestsCsv.text());
  expect(reqRows).toHaveLength(requests.length);
  const mineRow = reqRows.find(
    (r) => r[reqHeader.indexOf("request_id")] === mine.id,
  )!;
  expect(mineRow[reqHeader.indexOf("status")]).toBe("submitted");
  expect(mineRow[reqHeader.indexOf("answer_count")]).toBe(
    String(mine.answer_count),
  );

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
