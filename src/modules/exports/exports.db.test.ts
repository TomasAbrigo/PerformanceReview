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
import { employment, person } from "@/db/schema";
import {
  employmentIdOf,
  ingestFixtureCompany,
  insertCycle,
  insertGoal,
  insertJob,
  insertParticipant,
  insertPerson,
  insertRun,
  resetAll,
} from "@/modules/analytics/test-support";
import { exportRoute } from "@/modules/api/handlers";
import { listPeople } from "@/modules/people/queries";
import { CSV_BOM } from "./csv";

/** RFC 4180 parser: rows of cells (the BOM stripped). */
function parseCsv(text: string): string[][] {
  const body = text.startsWith(CSV_BOM) ? text.slice(1) : text;
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

async function download(
  file: string,
  query = "",
  headers?: HeadersInit,
): Promise<{ status: number; response: Response; text: string }> {
  const response = await exportRoute(
    new Request(`http://localhost/api/v1/export/${file}${query}`, { headers }),
    { params: Promise.resolve({ entity: file }) },
  );
  // response.text() would swallow the BOM: decode the raw bytes keeping it.
  const bytes = await response.arrayBuffer();
  return {
    status: response.status,
    response,
    text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
  };
}

/** Header + rows as records keyed by header. */
async function table(file: string, query = "") {
  const { text } = await download(file, query);
  const [header, ...rows] = parseCsv(text);
  return {
    header,
    rows: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))),
  };
}

let ana: string;
let bruno: string;
let carla: string;
let dora: string;
let cycleId: string;
let goalId: string;

beforeAll(async () => {
  await resetAll();
  ({ ana, bruno, carla } = await ingestFixtureCompany());

  dora = await insertPerson({
    displayName: 'Dora "Dori" Díaz, Jr.',
    workEmail: "dora@example.com",
    bambooId: "201",
    employeeNumber: "0201",
    hireDate: "2024-02-01",
  });
  await insertJob({
    personId: dora,
    validFrom: "2024-02-01",
    managerPersonId: bruno,
    employmentId: await employmentIdOf(dora),
    department: "Producto, Diseño",
    jobTitle: "=Designer",
  });
  await insertPerson({ displayName: "Sin empleo", noEmployment: true });
  goalId = await insertGoal(bruno, "Meta de Bruno", { dueDate: "2026-12-31" });
  await insertGoal(dora, "Meta de Dora");

  cycleId = await insertCycle("Ciclo 2025");
  await insertParticipant({
    cycleId,
    personId: bruno,
    snapManagerPersonId: ana,
  });
  await insertParticipant({ cycleId, personId: dora });

  await insertRun({
    status: "error",
    startedAt: new Date("2035-11-01T10:00:00Z"),
    entity: "goal",
    error: 'boom, "bad"',
    counts: { read: 5, inserted: 1, rejected: 4 },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await resetAll();
  await closeDb();
});

describe("people.csv", () => {
  it("is a UTF-8 CSV attachment starting with the BOM, with the agreed header", async () => {
    const { status, response, text } = await download("people.csv");
    expect(status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="people.csv"',
    );
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(parseCsv(text)[0]).toEqual([
      "person_id",
      "bamboo_id",
      "legajo",
      "email",
      "nombre",
      "estado",
      "manager_id",
      "manager",
      "área",
      "división",
      "puesto",
      "ubicación",
      "fecha ingreso",
      "fecha baja",
    ]);
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("has one row per person with internal and Bamboo ids, manager and org data", async () => {
    const { rows } = await table("people.csv");
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.person_id)).size).toBe(4);
    const by = new Map(rows.map((r) => [r.person_id, r]));
    expect(by.get(bruno)).toMatchObject({
      bamboo_id: "102",
      legajo: "0002",
      email: "bruno.perez@example.com",
      nombre: "Bruno Pérez",
      estado: "Active",
      manager_id: ana,
      manager: "Ana García",
      área: "Ingeniería",
      división: "Corporativo",
      puesto: "Senior Developer",
      ubicación: "Rosario",
      "fecha ingreso": "2021-07-15",
      "fecha baja": "",
    });
    expect(by.get(ana)).toMatchObject({
      bamboo_id: "101",
      manager_id: "",
      manager: "",
    });
    // Carla left: status Inactive, termination date, no current job.
    expect(by.get(carla)).toMatchObject({
      bamboo_id: "103",
      estado: "Inactive",
      "fecha baja": "2024-06-30",
      puesto: "",
    });
  });

  it("quotes commas and quotes and defuses formulas without losing the id columns", async () => {
    const { text } = await download("people.csv");
    expect(text).toContain('"Dora ""Dori"" Díaz, Jr."');
    expect(text).toContain('"Producto, Diseño"');
    expect(text).toContain("'=Designer");
    const { rows } = await table("people.csv");
    const row = rows.find((r) => r.person_id === dora)!;
    expect(row.nombre).toBe('Dora "Dori" Díaz, Jr.');
    expect(row.manager_id).toBe(bruno);
    expect(row.manager).toBe("Bruno Pérez");
  });

  it("applies the same filters as the list (q, active)", async () => {
    expect(
      (await table("people.csv", "?q=bruno")).rows.map((r) => r.person_id),
    ).toEqual([bruno]);
    const inactive = await table("people.csv", "?active=false");
    expect(inactive.rows.map((r) => r.person_id)).toEqual([carla]);
  });

  it("lists the same people as the people screen: live employment only", async () => {
    const screen = await listPeople(db);
    const { rows } = await table("people.csv");
    expect(rows.map((r) => r.person_id).sort()).toEqual(
      screen.map((p) => p.id).sort(),
    );
    expect(rows.map((r) => r.nombre)).not.toContain("Sin empleo");
    const searched = await table("people.csv", "?q=ana");
    expect(searched.rows.map((r) => r.person_id).sort()).toEqual(
      (await listPeople(db, "ana")).map((p) => p.id).sort(),
    );
  });

  it("writes the header in the language asked for (es by default)", async () => {
    const es = (await table("people.csv", "?locale=es")).header;
    expect(es).toEqual((await table("people.csv")).header);
    const en = (await table("people.csv", "?locale=en")).header;
    expect(en).toEqual([
      "person_id",
      "bamboo_id",
      "employee_number",
      "email",
      "name",
      "status",
      "manager_id",
      "manager",
      "department",
      "division",
      "job_title",
      "location",
      "hire_date",
      "termination_date",
    ]);
    // Same data, whatever the language.
    const rows = (await table("people.csv", "?locale=en")).rows;
    expect(rows.find((r) => r.person_id === bruno)).toMatchObject({
      employee_number: "0002",
      manager_id: ana,
      department: "Ingeniería",
    });
    const bad = await download("people.csv", "?locale=fr");
    expect(bad.status).toBe(400);
  });

  it("streams every person even when there are more than one page of them", async () => {
    const extra = await db
      .insert(person)
      .values(
        Array.from({ length: 620 }, (_, i) => ({ displayName: `Bulk ${i}` })),
      )
      .returning({ id: person.id });
    await db.insert(employment).values(
      extra.map((p, i) => ({
        personId: p.id,
        hireDate: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`,
        sourceSystem: "bamboo_api" as const,
        sourceId: `bulk-${i}`,
      })),
    );
    try {
      const { rows } = await table("people.csv");
      expect(rows).toHaveLength(4 + 620);
      expect(new Set(rows.map((r) => r.person_id)).size).toBe(624);
    } finally {
      await db.execute(
        sql`delete from employment where source_id like 'bulk-%'`,
      );
      await db.execute(
        sql`delete from person where display_name like 'Bulk %'`,
      );
      expect(extra).toHaveLength(620);
    }
  });
});

describe("org.csv", () => {
  it("lists the org on the date, one row per job row, with manager ids as of then", async () => {
    const { header, rows } = await table("org.csv", "?date=2022-06-01");
    expect(header).toEqual(
      expect.arrayContaining([
        "as_of",
        "job_history_id",
        "person_id",
        "bamboo_id",
        "legajo",
        "manager_id",
        "manager_bamboo_id",
      ]),
    );
    expect(rows.map((r) => r.person_id).sort()).toEqual(
      [ana, bruno, carla].sort(),
    );
    const row = rows.find((r) => r.person_id === bruno)!;
    expect(row).toMatchObject({
      as_of: "2022-06-01",
      bamboo_id: "102",
      legajo: "0002",
      manager_id: carla,
      manager_bamboo_id: "103",
      manager: "Carla Romero",
      puesto: "Developer",
    });
    expect(row.job_history_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("names the file after the date and rejects a bad date with 400", async () => {
    const ok = await download("org.csv", "?date=2022-06-01");
    expect(ok.response.headers.get("content-disposition")).toBe(
      'attachment; filename="org-2022-06-01.csv"',
    );
    const bad = await download("org.csv", "?date=nope");
    expect(bad.status).toBe(400);
    expect(bad.response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
  });
});

describe("every export follows the locale", () => {
  it.each([
    [
      "org.csv",
      "?date=2022-06-01&locale=en",
      ["as_of", "job_history_id", "valid_from", "valid_to"],
    ],
    [
      "goals.csv",
      "?locale=en",
      ["goal_id", "title", "percent_complete", "due_date"],
    ],
    [
      "ingest-runs.csv",
      "?locale=en",
      ["run_id", "source", "started_at", "log_entries"],
    ],
    [
      "cycle-participants.csv",
      "?locale=en",
      ["cycle_id", "cycle_name", "snapshot_manager", "added_at"],
    ],
  ])(
    "%s has English headers with ?locale=en",
    async (file, query, expected) => {
      const { header } = await table(file, query);
      expect(header).toEqual(expect.arrayContaining(expected));
      for (const spanish of ["área", "nombre", "título", "ciclo", "fuente"]) {
        expect(header).not.toContain(spanish);
      }
    },
  );
});

describe("goals.csv", () => {
  it("has one row per goal with owner ids, legajo, manager id and area", async () => {
    const { rows } = await table("goals.csv");
    expect(rows).toHaveLength(2);
    const row = rows.find((r) => r.goal_id === goalId)!;
    expect(row).toMatchObject({
      goal_bamboo_id: "goal-Meta de Bruno",
      person_id: bruno,
      bamboo_id: "102",
      legajo: "0002",
      nombre: "Bruno Pérez",
      manager_id: ana,
      manager_bamboo_id: "101",
      área: "Ingeniería",
      título: "Meta de Bruno",
      estado: "in_progress",
      vencimiento: "2026-12-31",
    });
  });

  it("filters by person and by manager", async () => {
    expect((await table("goals.csv", `?person_id=${dora}`)).rows).toHaveLength(
      1,
    );
    const team = await table("goals.csv", `?manager_id=${bruno}`);
    expect(team.rows.map((r) => r.person_id)).toEqual([dora]);
  });
});

describe("ingest-runs.csv", () => {
  it("has one row per run with ids, counts and the error", async () => {
    const { rows } = await table("ingest-runs.csv", "?status=error");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fuente: "bamboo_api",
      entidad: "goal",
      estado: "error",
      leídos: "5",
      insertados: "1",
      rechazados: "4",
      error: 'boom, "bad"',
    });
    expect(rows[0].run_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("cycle-participants.csv", () => {
  it("has one row per participant with cycle, person and snapshot manager ids and area", async () => {
    const { header, rows } = await table("cycle-participants.csv");
    expect(header.slice(0, 4)).toEqual([
      "cycle_id",
      "cycle_source_id",
      "ciclo",
      "snapshot_as_of",
    ]);
    expect(rows).toHaveLength(2);
    const row = rows.find((r) => r.person_id === bruno)!;
    expect(row).toMatchObject({
      cycle_id: cycleId,
      ciclo: "Ciclo 2025",
      snapshot_as_of: "2025-06-01",
      bamboo_id: "102",
      legajo: "0002",
      snapshot_manager_id: ana,
      snapshot_manager_bamboo_id: "101",
      snapshot_manager: "Ana García",
      área: "Tecnología",
    });
    const noManager = rows.find((r) => r.person_id === dora)!;
    expect(noManager.snapshot_manager_id).toBe("");
  });

  it("filters by cycle", async () => {
    expect(
      (await table("cycle-participants.csv", `?cycle_id=${cycleId}`)).rows,
    ).toHaveLength(2);
    expect(
      (
        await table(
          "cycle-participants.csv",
          "?cycle_id=00000000-0000-4000-8000-000000000000",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (await download("cycle-participants.csv", "?cycle_id=x")).status,
    ).toBe(400);
  });
});

describe("export routing and auth", () => {
  it("answers 404 for an unknown export", async () => {
    for (const entity of [
      "nope.csv",
      "people",
      "people.json",
      "../people.csv",
    ]) {
      const res = await exportRoute(
        new Request("http://localhost/api/v1/export/x"),
        { params: Promise.resolve({ entity }) },
      );
      expect([entity, res.status]).toEqual([entity, 404]);
    }
  });

  it("is behind the API_TOKEN gate like the JSON API", async () => {
    vi.stubEnv("API_TOKEN", "s3cret");
    expect((await download("people.csv")).status).toBe(401);
    expect(
      (await download("people.csv", "", { Authorization: "Bearer s3cret" }))
        .status,
    ).toBe(200);
  });
});
