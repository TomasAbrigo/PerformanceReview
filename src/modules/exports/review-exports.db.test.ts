import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { person } from "@/db/schema";
import { insertParticipant, resetAll } from "@/modules/analytics/test-support";
import {
  call,
  insertAnswers,
  insertQuestion,
  insertRequest,
  insertRequests,
  insertReviewCycle,
  seedReviewScenario,
} from "@/modules/api/review-test-support";
import { listCycleRequestsRoute } from "@/modules/api/handlers";
import { getReview } from "@/modules/review-core";
import { CSV_BOM } from "./csv";
import { download, parseCsv, table } from "./csv-test-support";

const MISSING = "00000000-0000-4000-8000-000000000000";
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/;

let s: Awaited<ReturnType<typeof seedReviewScenario>>;

beforeAll(async () => {
  s = await seedReviewScenario();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await resetAll();
  await closeDb();
});

const ANSWER_HEADERS_ES = [
  "cycle_id",
  "cycle_source_id",
  "ciclo",
  "participant_id",
  "request_id",
  "person_id",
  "bamboo_id",
  "legajo",
  "nombre",
  "snapshot_as_of",
  "snapshot_manager_id",
  "snapshot_manager_bamboo_id",
  "snapshot_manager",
  "área",
  "división",
  "puesto",
  "ubicación",
  "relación",
  "estado",
  "reviewer_id",
  "reviewer_bamboo_id",
  "evaluador",
  "evaluador visible",
  "adicional",
  "asignado por RR. HH.",
  "enviado en nombre del evaluador",
  "question_revision_id",
  "rol de la pregunta",
  "tipo de pregunta",
  "pregunta (es)",
  "pregunta (en)",
  "valor",
  "etiqueta",
  "normalizado",
  "texto",
  "enviado",
  "compartido",
];

const ANSWER_HEADERS_EN = [
  "cycle_id",
  "cycle_source_id",
  "cycle_name",
  "participant_id",
  "request_id",
  "person_id",
  "bamboo_id",
  "employee_number",
  "name",
  "snapshot_as_of",
  "snapshot_manager_id",
  "snapshot_manager_bamboo_id",
  "snapshot_manager",
  "department",
  "division",
  "job_title",
  "location",
  "relationship",
  "status",
  "reviewer_id",
  "reviewer_bamboo_id",
  "reviewer",
  "reviewer_visible",
  "additional",
  "assigned_by_hr",
  "submitted_on_behalf",
  "question_revision_id",
  "question_role",
  "question_kind",
  "question_prompt_es",
  "question_prompt_en",
  "answer_value",
  "answer_label",
  "normalized",
  "answer_text",
  "submitted_at",
  "shared_at",
];

/** Answers on requests that are not deleted: what the export has to contain. */
const answerCount = async (cycleId?: string) =>
  Number(
    (
      await db.execute(sql`
        select count(*)::int as n from answer a
        join review_request r on r.id = a.request_id
        where r.deleted_at is null
          ${cycleId ? sql`and r.cycle_id = ${cycleId}::uuid` : sql``}
      `)
    )[0].n,
  );

describe("answers.csv", () => {
  it("is a UTF-8 CSV attachment with the BOM and the agreed Spanish header", async () => {
    const { status, response, text } = await download("answers.csv");
    expect(status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="answers.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(parseCsv(text)[0]).toEqual(ANSWER_HEADERS_ES);
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("writes the same columns, in the same order and with the same data, in English", async () => {
    const es = await table("answers.csv");
    const en = await table("answers.csv", "?locale=en");
    expect(en.header).toEqual(ANSWER_HEADERS_EN);
    expect(en.header).toHaveLength(es.header.length);
    expect(en.rows).toHaveLength(es.rows.length);
    // Cell for cell the same, whatever the header language.
    const cells = (t: typeof es) =>
      t.rows.map((r) => t.header.map((h) => r[h]));
    expect(cells(en)).toEqual(cells(es));
    expect((await download("answers.csv", "?locale=fr")).status).toBe(400);
  });

  it("has one row per answer: as many as the answers of the cycle's live requests", async () => {
    const { rows } = await table("answers.csv");
    expect(rows).toHaveLength(9);
    expect(rows).toHaveLength(await answerCount());
    // One row per reviewer x question: no pair repeats.
    const pairs = rows.map((r) => `${r.request_id}|${r.question_revision_id}`);
    expect(new Set(pairs).size).toBe(rows.length);
    // The deleted request's answer is not there.
    expect(rows.map((r) => r.texto)).not.toContain("borrada");
  });

  it("carries internal and Bamboo ids, snapshot manager, area, reviewer and the answer", async () => {
    const { rows } = await table("answers.csv");
    const rating = rows.find(
      (r) => r.request_id === s.mgrDora && r.question_revision_id === s.q2,
    )!;
    expect(rating).toMatchObject({
      cycle_id: s.cycleId,
      cycle_source_id: "",
      ciclo: "Ciclo 360",
      participant_id: s.pDora,
      person_id: s.dora,
      bamboo_id: "201",
      legajo: "0201",
      nombre: "Dora Díaz",
      snapshot_as_of: "2025-06-01",
      snapshot_manager_id: s.bruno,
      snapshot_manager_bamboo_id: "102",
      snapshot_manager: "Bruno Pérez",
      área: "Producto",
      puesto: "Designer",
      relación: "manager",
      estado: "submitted",
      reviewer_id: s.bruno,
      reviewer_bamboo_id: "102",
      evaluador: "Bruno Pérez",
      "evaluador visible": "true",
      "rol de la pregunta": "overall_rating",
      "tipo de pregunta": "rating",
      "pregunta (es)": "Rating general",
      "pregunta (en)": "Overall rating",
      valor: "3",
      etiqueta: "Alto",
      texto: "",
      compartido: "2025-07-01T09:30:00.123000Z",
    });
    expect(Number(rating.normalizado)).toBeCloseTo(2 / 3, 10);
    expect(rating.enviado).toMatch(ISO);

    const text = rows.find(
      (r) => r.request_id === s.selfDora && r.question_revision_id === s.q1,
    )!;
    expect(text).toMatchObject({
      relación: "self",
      reviewer_id: s.dora,
      "rol de la pregunta": "",
      "pregunta (es)": "¿Cómo te fue?",
      valor: "",
      etiqueta: "",
      normalizado: "",
      texto: "Un buen año",
      compartido: "",
    });

    const choice = rows.find(
      (r) => r.request_id === s.peerDora && r.question_revision_id === s.q3,
    )!;
    expect(choice).toMatchObject({
      "tipo de pregunta": "single_choice",
      valor: "",
      etiqueta: "team",
    });
  });

  it("orders the rows request by request, each in question order", async () => {
    const { rows } = await table("answers.csv", `?cycle_id=${s.cycleId}`);
    const sortOf = new Map([
      [s.q1, 0],
      [s.q2, 1],
      [s.q3, 2],
      [s.q4, 3],
    ]);
    const seen = new Set<string>();
    let last: string | null = null;
    let lastSort = -1;
    for (const r of rows) {
      if (r.request_id !== last) {
        // A request's rows are contiguous.
        expect(seen.has(r.request_id)).toBe(false);
        seen.add(r.request_id);
        last = r.request_id;
        lastSort = -1;
      }
      const sort = sortOf.get(r.question_revision_id)!;
      expect(sort).toBeGreaterThan(lastSort);
      lastSort = sort;
    }
  });

  it("filters by cycle, relationship and status", async () => {
    const other = await insertReviewCycle({ name: "Otro ciclo" });
    const participant = await insertParticipant({
      cycleId: other,
      personId: s.ana,
    });
    const request = await insertRequest({
      cycleId: other,
      participantId: participant,
      reviewerPersonId: s.ana,
      relationship: "self",
    });
    const q = await insertQuestion({ cycleId: other, sort: 0, kind: "text" });
    await insertAnswers([
      { requestId: request, questionRevisionId: q, textValue: "otra" },
    ]);

    expect((await table("answers.csv")).rows).toHaveLength(10);
    const ofOther = await table("answers.csv", `?cycle_id=${other}`);
    expect(ofOther.rows.map((r) => r.texto)).toEqual(["otra"]);
    expect(
      (await table("answers.csv", `?cycle_id=${s.cycleId}`)).rows,
    ).toHaveLength(9);

    const peers = await table(
      "answers.csv",
      `?cycle_id=${s.cycleId}&relationship=peer`,
    );
    expect(peers.rows.map((r) => r.relación)).toEqual(["peer", "peer"]);
    const drafts = await table("answers.csv", "?status=draft");
    expect(drafts.rows).toHaveLength(0);
    const submitted = await table(
      "answers.csv",
      `?cycle_id=${s.cycleId}&status=submitted&relationship=self`,
    );
    expect(submitted.rows).toHaveLength(3);
    expect((await table("answers.csv", `?cycle_id=${MISSING}`)).rows).toEqual(
      [],
    );
  });

  it.each([
    ["cycle_id=nope", "cycle_id"],
    ["relationship=boss", "relationship"],
    ["status=late", "status"],
    ["as_person=nope", "as_person"],
    ["role=manager", "role"],
  ])("answers 400 problem+json for %s", async (query, field) => {
    const { status, response, text } = await download(
      "answers.csv",
      `?${query}`,
    );
    expect(status).toBe(400);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(
      JSON.parse(text).errors.map((e: { path: string }) => e.path),
    ).toContain(field);
  });

  it("quotes commas and quotes and defuses formulas in answers", async () => {
    const cycle = await insertReviewCycle({ name: "Fórmulas" });
    const participant = await insertParticipant({
      cycleId: cycle,
      personId: s.ana,
    });
    const request = await insertRequest({
      cycleId: cycle,
      participantId: participant,
      reviewerPersonId: s.ana,
      relationship: "self",
    });
    const q = await insertQuestion({ cycleId: cycle, sort: 0, kind: "text" });
    await insertAnswers([
      {
        requestId: request,
        questionRevisionId: q,
        textValue: '=1+1, "dos"\nlínea',
      },
    ]);
    const { text } = await download("answers.csv", `?cycle_id=${cycle}`);
    expect(text).toContain('"\'=1+1, ""dos""\nlínea"');
    const rows = (await table("answers.csv", `?cycle_id=${cycle}`)).rows;
    expect(rows[0].texto).toBe('\'=1+1, "dos"\nlínea');
  });

  describe("reviewer anonymity", () => {
    it("leaves the reviewer cells empty (and says so) for fully anonymous feedback, whatever the scope", async () => {
      // Upward feedback of the 360 cycle is fully_anonymous: written by Dora about Bruno.
      for (const scope of [
        "",
        "&scope=hr",
        `&as_person=${s.ana}&role=hr`,
        `&as_person=${s.ana}&role=manager`,
      ]) {
        const { rows, header } = await table(
          "answers.csv",
          `?cycle_id=${s.cycleId}&relationship=upward${scope}`,
        );
        expect(rows, scope).toHaveLength(1);
        expect(rows[0], scope).toMatchObject({
          relación: "upward",
          person_id: s.bruno,
          reviewer_id: "",
          reviewer_bamboo_id: "",
          evaluador: "",
          "evaluador visible": "false",
          texto: "Escucha",
        });
        expect(header).toContain("reviewer_id");
      }
    });

    it("names peers only to HR when the cycle is anonymous to the employee", async () => {
      const peers = (
        await table("answers.csv", `?cycle_id=${s.cycleId}&relationship=peer`)
      ).rows;
      expect(peers.map((r) => r.evaluador)).toEqual(["Eva Peña", "Eva Peña"]);
      expect(peers.map((r) => r["evaluador visible"])).toEqual([
        "true",
        "true",
      ]);
      // Dora, the reviewee, reads the peer feedback about her without the name.
      const asDora = (
        await table(
          "answers.csv",
          `?cycle_id=${s.cycleId}&relationship=peer&as_person=${s.dora}`,
        )
      ).rows;
      expect(asDora).toHaveLength(2);
      expect(asDora.map((r) => r.evaluador)).toEqual(["", ""]);
      expect(asDora.map((r) => r.reviewer_id)).toEqual(["", ""]);
      expect(asDora.map((r) => r["evaluador visible"])).toEqual([
        "false",
        "false",
      ]);
    });
  });

  describe("scope", () => {
    it("with as_person exports what canRead lets that person read, nothing else", async () => {
      for (const [personId, role] of [
        [s.dora, "employee"],
        [s.bruno, "manager"],
        [s.ana, "manager"],
        [s.eva, "peer"],
        [s.outsider, "employee"],
      ] as const) {
        const actor = { personId, role };
        let expected = 0;
        for (const id of [
          s.selfDora,
          s.mgrDora,
          s.peerDora,
          s.peerDraft,
          s.upwardBruno,
          s.selfBruno,
          s.selfCarla,
        ]) {
          const review = await getReview(db, actor, id);
          if (review) expected += Object.keys(review.answers).length;
        }
        const { rows } = await table(
          "answers.csv",
          `?cycle_id=${s.cycleId}&as_person=${personId}&role=${role}`,
        );
        expect(rows, `${role} ${personId}`).toHaveLength(expected);
      }
      // The reviewee does not get the questions hidden from them.
      const asDora = await table(
        "answers.csv",
        `?cycle_id=${s.cycleId}&relationship=manager&as_person=${s.dora}`,
      );
      expect(asDora.rows.map((r) => r.question_revision_id).sort()).toEqual(
        [s.q1, s.q4].sort(),
      );
    });

    it("answers 404 (not a CSV) for an as_person that is not a person", async () => {
      const { status, response } = await download(
        "answers.csv",
        `?as_person=${MISSING}`,
      );
      expect(status).toBe(404);
      expect(response.headers.get("content-type")).toBe(
        "application/problem+json",
      );
    });
  });

  it("requires the bearer token when API_TOKEN is set", async () => {
    vi.stubEnv("API_TOKEN", "s3cret");
    const denied = await download("answers.csv");
    expect(denied.status).toBe(401);
    expect(denied.response.headers.get("www-authenticate")).toBe("Bearer");
    const allowed = await download("answers.csv", "", {
      Authorization: "Bearer s3cret",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.text.startsWith(CSV_BOM)).toBe(true);
  });

  it("streams every answer when there are several pages of requests", async () => {
    const cycle = await insertReviewCycle({ name: "Ciclo enorme" });
    const participant = await insertParticipant({
      cycleId: cycle,
      personId: s.dora,
      snapManagerPersonId: s.bruno,
    });
    const reviewers = await db
      .insert(person)
      .values(
        Array.from({ length: 450 }, (_, i) => ({ displayName: `Par ${i}` })),
      )
      .returning({ id: person.id });
    const requests = await insertRequests(
      reviewers.map((r) => ({
        cycleId: cycle,
        participantId: participant,
        reviewerPersonId: r.id,
        relationship: "peer" as const,
      })),
    );
    const q1 = await insertQuestion({ cycleId: cycle, sort: 0, kind: "text" });
    const q2 = await insertQuestion({ cycleId: cycle, sort: 1, kind: "text" });
    await insertAnswers(
      requests.flatMap((requestId) => [
        { requestId, questionRevisionId: q1, textValue: "a" },
        { requestId, questionRevisionId: q2, textValue: "b" },
      ]),
    );
    const { rows } = await table("answers.csv", `?cycle_id=${cycle}`);
    expect(rows).toHaveLength(900);
    expect(rows).toHaveLength(await answerCount(cycle));
    expect(new Set(rows.map((r) => r.request_id)).size).toBe(450);
    const pairs = rows.map((r) => `${r.request_id}|${r.question_revision_id}`);
    expect(new Set(pairs).size).toBe(900);
  });
});

describe("requests.csv", () => {
  const REQUEST_HEADERS_EN = [
    "cycle_id",
    "cycle_source_id",
    "cycle_name",
    "participant_id",
    "request_id",
    "person_id",
    "bamboo_id",
    "employee_number",
    "name",
    "snapshot_as_of",
    "snapshot_manager_id",
    "snapshot_manager_bamboo_id",
    "snapshot_manager",
    "department",
    "division",
    "job_title",
    "location",
    "relationship",
    "status",
    "reviewer_id",
    "reviewer_bamboo_id",
    "reviewer",
    "reviewer_visible",
    "additional",
    "assigned_by_hr",
    "submitted_on_behalf",
    "participant_removed_at",
    "reviewer_missing",
    "reviewer_mismatch",
    "rating_stage",
    "rating_value",
    "rating_label",
    "rating_normalized",
    "requested_at",
    "submitted_at",
    "declined_at",
    "shared_at",
    "answer_count",
  ];

  it("has the same columns in both languages and one row per live request", async () => {
    const es = await table("requests.csv");
    const en = await table("requests.csv", "?locale=en");
    expect(en.header).toEqual(REQUEST_HEADERS_EN);
    expect(es.header).toHaveLength(en.header.length);
    expect(es.header).toContain("relación");
    expect(es.header).toContain("participante removido");
    expect(es.rows).toHaveLength(en.rows.length);
    const cycleRows = (
      await table("requests.csv", `?cycle_id=${s.cycleId}&locale=en`)
    ).rows;
    expect(cycleRows.map((r) => r.request_id).sort()).toEqual(
      [
        s.selfDora,
        s.mgrDora,
        s.peerDora,
        s.peerDraft,
        s.upwardBruno,
        s.selfBruno,
        s.selfCarla,
      ].sort(),
    );
  });

  it("lists exactly the requests of the JSON endpoint, with the same facts", async () => {
    const json = await call(
      listCycleRequestsRoute,
      `/api/v1/cycles/${s.cycleId}/requests?limit=200`,
      s.cycleId,
    );
    const csv = (
      await table("requests.csv", `?cycle_id=${s.cycleId}&locale=en`)
    ).rows;
    expect(csv.map((r) => r.request_id).sort()).toEqual(
      json.body.data.map((r: { id: string }) => r.id).sort(),
    );
    const mgr = csv.find((r) => r.request_id === s.mgrDora)!;
    expect(mgr).toMatchObject({
      cycle_id: s.cycleId,
      cycle_name: "Ciclo 360",
      participant_id: s.pDora,
      person_id: s.dora,
      bamboo_id: "201",
      employee_number: "0201",
      name: "Dora Díaz",
      snapshot_manager_id: s.bruno,
      snapshot_manager_bamboo_id: "102",
      department: "Producto",
      relationship: "manager",
      status: "submitted",
      reviewer_id: s.bruno,
      reviewer: "Bruno Pérez",
      reviewer_visible: "true",
      participant_removed_at: "",
      reviewer_missing: "false",
      reviewer_mismatch: "false",
      rating_stage: "calibrated",
      rating_value: "4",
      rating_label: "Máximo",
      rating_normalized: "1",
      additional: "false",
      assigned_by_hr: "false",
      submitted_on_behalf: "false",
      shared_at: "2025-07-01T09:30:00.123000Z",
      answer_count: "3",
    });
    expect(mgr.requested_at).toMatch(ISO);
    expect(mgr.submitted_at).toMatch(ISO);
    const removed = csv.find((r) => r.request_id === s.selfCarla)!;
    expect(removed.participant_removed_at).toMatch(ISO);
    const draft = csv.find((r) => r.request_id === s.peerDraft)!;
    expect(draft).toMatchObject({
      status: "draft",
      submitted_at: "",
      answer_count: "0",
    });
  });

  it("filters by cycle, relationship and status, and hides fully anonymous reviewers", async () => {
    const peers = await table(
      "requests.csv",
      `?cycle_id=${s.cycleId}&relationship=peer&status=draft&locale=en`,
    );
    expect(peers.rows.map((r) => r.request_id)).toEqual([s.peerDraft]);
    const upward = await table(
      "requests.csv",
      `?cycle_id=${s.cycleId}&relationship=upward&locale=en`,
    );
    expect(upward.rows).toHaveLength(1);
    expect(upward.rows[0]).toMatchObject({
      reviewer_id: "",
      reviewer_bamboo_id: "",
      reviewer: "",
      reviewer_visible: "false",
    });
    const bad = await download("requests.csv", "?relationship=boss");
    expect(bad.status).toBe(400);
  });

  it("applies as_person like the JSON endpoint and requires the token", async () => {
    const asOutsider = await table(
      "requests.csv",
      `?as_person=${s.outsider}&locale=en`,
    );
    expect(asOutsider.rows).toEqual([]);
    const asDora = await table(
      "requests.csv",
      `?as_person=${s.dora}&locale=en`,
    );
    expect(asDora.rows.length).toBeGreaterThan(0);
    // The rating is for HR only.
    for (const row of asDora.rows) {
      expect(row.rating_stage).toBe("");
      expect(row.rating_value).toBe("");
    }
    vi.stubEnv("API_TOKEN", "s3cret");
    expect((await download("requests.csv")).status).toBe(401);
  });
});
