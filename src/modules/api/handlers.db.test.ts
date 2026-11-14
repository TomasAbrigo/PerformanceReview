import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { goalMilestone, goalShare, person } from "@/db/schema";
import {
  employmentIdOf,
  ingestFixtureCompany,
  insertCycle,
  insertGoal,
  insertIdentityIssue,
  insertJob,
  insertParticipant,
  insertPerson,
  insertRun,
  resetAll,
} from "@/modules/analytics/test-support";
import {
  getCycleRoute,
  getPersonRoute,
  getRunRoute,
  listCyclesRoute,
  listGoalsRoute,
  listIdentityIssuesRoute,
  listPeopleRoute,
  listRunsRoute,
  orgAsOfRoute,
  personGoalsRoute,
} from "./handlers";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Route = (
  request: Request,
  context?: { params: Promise<{ id: string }> },
) => Promise<Response>;

async function call(
  route: Route,
  path: string,
  id?: string,
  headers?: HeadersInit,
) {
  const response = await route(
    new Request(`http://localhost${path}`, { headers }),
    id === undefined ? undefined : { params: Promise.resolve({ id }) },
  );
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    body: (await response.json()) as Json,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/;

let ana: string;
let bruno: string;
let carla: string;
let extras: string[];
let cycleId: string;
let brunoGoal: string;
let runIds: string[];
let rejectRun: string;
let issueOpen: string;
let issueResolved: string;

/** Walks a list endpoint page by page, returning every id in order. */
async function walk(
  route: Route,
  path: string,
  limit: number,
  from: string | null = null,
) {
  const sep = path.includes("?") ? "&" : "?";
  const ids: string[] = [];
  let cursor: string | null = from;
  for (let guard = 0; guard < 50; guard++) {
    const res = await call(
      route,
      `${path}${sep}limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
    );
    expect(res.status).toBe(200);
    ids.push(...res.body.data.map((r: Json) => r.id));
    cursor = res.body.next_cursor;
    if (!cursor) return ids;
  }
  throw new Error("pagination did not terminate");
}

beforeAll(async () => {
  await resetAll();
  ({ ana, bruno, carla } = await ingestFixtureCompany());

  // Five people inserted by ONE statement: identical created_at, so only the
  // id tie-break keeps their order stable across pages.
  const rows = await db
    .insert(person)
    .values(
      [1, 2, 3, 4, 5].map((n) => ({
        displayName: `Extra ${n}`,
        workEmail: `extra${n}@example.com`,
      })),
    )
    .returning({ id: person.id });
  extras = rows.map((r) => r.id);

  const dora = await insertPerson({
    displayName: "Dora Díaz",
    bambooId: "201",
    employeeNumber: "0201",
  });
  await insertJob({
    personId: dora,
    validFrom: "2024-02-01",
    managerPersonId: bruno,
    employmentId: await employmentIdOf(dora),
  });

  brunoGoal = await insertGoal(bruno, "Meta de Bruno", {
    dueDate: "2026-12-31",
  });
  await insertGoal(ana, "Meta de Ana");
  await insertGoal(carla, "Meta borrada", { deleted: true });
  await db.insert(goalMilestone).values({
    goalId: brunoGoal,
    title: "Hito 1",
    position: 0,
    sourceSystem: "bamboo_api",
    sourceId: "m1",
  });
  await db.insert(goalShare).values({ goalId: brunoGoal, personId: ana });

  cycleId = await insertCycle("Ciclo 2025");
  await insertParticipant({
    cycleId,
    personId: bruno,
    snapManagerPersonId: ana,
  });
  await insertParticipant({ cycleId, personId: ana });
  await insertParticipant({
    cycleId,
    personId: carla,
    snapManagerPersonId: ana,
    removed: true,
  });

  // Far in the future: newer than the runs the fixture ingest just left.
  const base = new Date("2035-11-01T10:00:00.000Z").getTime();
  runIds = [];
  for (const [i, status] of (
    ["succeeded", "error", "succeeded", "error"] as const
  ).entries()) {
    runIds.push(
      await insertRun({
        status,
        startedAt: new Date(base + i * 60_000),
        error: status === "error" ? "boom" : undefined,
        entity: i < 2 ? "employee" : "goal",
      }),
    );
  }
  rejectRun = await insertRun({
    status: "succeeded",
    startedAt: new Date(base + 10 * 60_000),
    counts: { read: 3, inserted: 2, rejected: 1 },
    rejects: [{ sourceId: "77", reason: "unknown employee" }],
  });
  issueOpen = await insertIdentityIssue({
    runId: rejectRun,
    sourceId: "900",
    displayName: "Sin Resolver",
  });
  issueResolved = await insertIdentityIssue({
    runId: rejectRun,
    sourceId: "901",
    status: "resolved",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await resetAll();
  await closeDb();
});

describe("GET /api/v1/people", () => {
  it("lists people with internal id, Bamboo source id, current job and ISO timestamps", async () => {
    const res = await call(listPeopleRoute, "/api/v1/people?q=bruno");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/^application\/json/);
    expect(res.body.next_cursor).toBeNull();
    expect(res.body.data).toHaveLength(1);
    const p = res.body.data[0];
    expect(p).toMatchObject({
      id: bruno,
      source: { system: "bamboo_api", id: "102" },
      display_name: "Bruno Pérez",
      work_email: "bruno.perez@example.com",
      employee_number: "0002",
      status: "Active",
      active: true,
      hire_date: "2021-07-15",
      termination_date: null,
    });
    expect(p.current_job).toMatchObject({
      department: "Ingeniería",
      job_title: "Senior Developer",
      location: "Rosario",
      manager: {
        id: ana,
        source: { system: "bamboo_api", id: "101" },
        display_name: "Ana García",
      },
    });
    expect(p.created_at).toMatch(ISO);
    expect(p.updated_at).toMatch(ISO);
  });

  it("includes people without Bamboo identity or job (source and current_job are null)", async () => {
    const res = await call(listPeopleRoute, "/api/v1/people?q=extra%203");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: extras[2],
      source: null,
      status: null,
      active: false,
      current_job: null,
    });
  });

  it("filters by active status", async () => {
    const inactive = await call(
      listPeopleRoute,
      "/api/v1/people?active=false&q=carla",
    );
    expect(inactive.body.data.map((p: Json) => p.id)).toEqual([carla]);
    const active = await call(
      listPeopleRoute,
      "/api/v1/people?active=true&limit=200",
    );
    const ids = active.body.data.map((p: Json) => p.id);
    expect(ids).toEqual(expect.arrayContaining([ana, bruno]));
    expect(ids).not.toContain(carla);
    expect(ids).not.toContain(extras[0]);
  });

  it("matches the q filter on name or email, escaping wildcards", async () => {
    const byEmail = await call(listPeopleRoute, "/api/v1/people?q=EXTRA1@");
    expect(byEmail.body.data.map((p: Json) => p.id)).toEqual([extras[0]]);
    const wildcard = await call(listPeopleRoute, "/api/v1/people?q=%25");
    expect(wildcard.body.data).toEqual([]);
  });

  it("pages stably: every person exactly once, in the same order as one big page", async () => {
    const all = await call(listPeopleRoute, "/api/v1/people?limit=200");
    const expected = all.body.data.map((p: Json) => p.id);
    expect(expected).toHaveLength(9);
    expect(new Set(expected).size).toBe(9);
    for (const limit of [1, 2, 4, 9]) {
      expect(await walk(listPeopleRoute, "/api/v1/people", limit)).toEqual(
        expected,
      );
    }
  });

  it("gives a next_cursor only while there is more", async () => {
    const first = await call(listPeopleRoute, "/api/v1/people?limit=9");
    expect(first.body.next_cursor).toBeNull();
    const partial = await call(listPeopleRoute, "/api/v1/people?limit=8");
    expect(typeof partial.body.next_cursor).toBe("string");
  });

  it("keeps the next pages stable when a new person arrives meanwhile", async () => {
    const first = await call(listPeopleRoute, "/api/v1/people?limit=4");
    const [late] = await db
      .insert(person)
      .values({ displayName: "Llegada tarde" })
      .returning({ id: person.id });
    try {
      const rest = await walk(
        listPeopleRoute,
        "/api/v1/people",
        3,
        first.body.next_cursor,
      );
      const seen = [...first.body.data.map((p: Json) => p.id), ...rest];
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toContain(late.id);
      expect(seen.slice(0, 4)).toEqual(first.body.data.map((p: Json) => p.id));
    } finally {
      await db.delete(person).where(eq(person.id, late.id));
    }
  });

  it.each([
    ["limit=0", "limit"],
    ["limit=201", "limit"],
    ["limit=abc", "limit"],
    ["active=maybe", "active"],
    ["cursor=garbage", "cursor"],
  ])("answers 400 problem+json for %s", async (query, field) => {
    const res = await call(listPeopleRoute, `/api/v1/people?${query}`);
    expect(res.status).toBe(400);
    expect(res.type).toBe("application/problem+json");
    expect(res.body).toMatchObject({ status: 400, title: "Bad Request" });
    expect(res.body.errors.map((e: Json) => e.path)).toContain(field);
  });
});

describe("GET /api/v1/people/{id}", () => {
  it("returns identities, employments and job history with ids and sources", async () => {
    const res = await call(getPersonRoute, `/api/v1/people/${bruno}`, bruno);
    expect(res.status).toBe(200);
    const p = res.body.data;
    expect(p).toMatchObject({
      id: bruno,
      source: { system: "bamboo_api", id: "102" },
      display_name: "Bruno Pérez",
    });
    expect(
      p.source_identities.map((i: Json) => [i.kind, i.value, i.system]).sort(),
    ).toEqual(
      expect.arrayContaining([
        ["bamboo_id", "102", "bamboo_api"],
        ["employee_number", "0002", "bamboo_api"],
        ["work_email", "bruno.perez@example.com", "bamboo_api"],
      ]),
    );
    expect(p.source_identities[0].valid_from).toMatch(ISO);
    expect(p.source_identities[0].id).toMatch(UUID);
    expect(p.employments).toHaveLength(1);
    expect(p.employments[0]).toMatchObject({
      source: { system: "bamboo_api", id: "102" },
      hire_date: "2021-07-15",
      termination_date: null,
      status: "Active",
    });
    expect(p.job_history).toHaveLength(2);
    // newest first
    expect(p.job_history[0]).toMatchObject({
      valid_from: "2023-01-01",
      valid_to: null,
      job_title: "Senior Developer",
      employment_id: p.employments[0].id,
      manager: { id: ana, source: { system: "bamboo_api", id: "101" } },
    });
    expect(p.job_history[0].id).toMatch(UUID);
    expect(p.job_history[1]).toMatchObject({
      valid_from: "2021-07-15",
      valid_to: "2023-01-01",
      manager: { id: carla },
    });
  });

  it("answers 404 for an unknown or malformed id", async () => {
    const unknown = await call(
      getPersonRoute,
      "/api/v1/people/00000000-0000-4000-8000-000000000000",
      "00000000-0000-4000-8000-000000000000",
    );
    expect(unknown.status).toBe(404);
    expect(unknown.type).toBe("application/problem+json");
    const malformed = await call(getPersonRoute, "/api/v1/people/nope", "nope");
    expect(malformed.status).toBe(404);
  });
});

describe("GET /api/v1/org/as-of", () => {
  it("returns the org valid on the date, with managers as of then", async () => {
    const res = await call(
      orgAsOfRoute,
      "/api/v1/org/as-of?date=2022-06-01&limit=200",
    );
    expect(res.status).toBe(200);
    expect(res.body.as_of).toBe("2022-06-01");
    const byPerson = new Map<string, Json>(
      res.body.data.map((r: Json) => [r.person.id, r]),
    );
    expect([...byPerson.keys()].sort()).toEqual([ana, bruno, carla].sort());
    const row = byPerson.get(bruno)!;
    expect(row).toMatchObject({
      valid_from: "2021-07-15",
      valid_to: "2023-01-01",
      job_title: "Developer",
      manager: { id: carla, source: { system: "bamboo_api", id: "103" } },
      person: { source: { system: "bamboo_api", id: "102" } },
    });
    expect(row.id).toMatch(UUID);
    expect(byPerson.get(ana)!.manager).toBeNull();
  });

  it("drops people who left and shows later managers on a later date", async () => {
    const res = await call(
      orgAsOfRoute,
      "/api/v1/org/as-of?date=2025-01-01&limit=200",
    );
    const byPerson = new Map<string, Json>(
      res.body.data.map((r: Json) => [r.person.id, r]),
    );
    expect(byPerson.has(carla)).toBe(false);
    expect(byPerson.get(bruno)!.manager.id).toBe(ana);
  });

  it("pages stably", async () => {
    const whole = await call(
      orgAsOfRoute,
      "/api/v1/org/as-of?date=2025-01-01&limit=200",
    );
    const expected = whole.body.data.map((r: Json) => r.id);
    expect(
      await walk(orgAsOfRoute, "/api/v1/org/as-of?date=2025-01-01", 1),
    ).toEqual(expected);
  });

  it("defaults the date to today and rejects an invalid one with 400", async () => {
    const today = await call(orgAsOfRoute, "/api/v1/org/as-of");
    expect(today.status).toBe(200);
    expect(today.body.as_of).toMatch(/^\d{4}-\d\d-\d\d$/);
    for (const date of ["2022-13-45", "yesterday", "2022-6-1"]) {
      const res = await call(orgAsOfRoute, `/api/v1/org/as-of?date=${date}`);
      expect(res.status).toBe(400);
      expect(res.body.errors.map((e: Json) => e.path)).toContain("date");
    }
  });
});

describe("goals", () => {
  it("lists goals with owner ref, milestones and sharing; never deleted ones", async () => {
    const res = await call(listGoalsRoute, "/api/v1/goals?limit=200");
    expect(res.status).toBe(200);
    expect(res.body.data.map((g: Json) => g.title).sort()).toEqual([
      "Meta de Ana",
      "Meta de Bruno",
    ]);
    const g = res.body.data.find((x: Json) => x.id === brunoGoal);
    expect(g).toMatchObject({
      source: { system: "bamboo_api", id: "goal-Meta de Bruno" },
      person: {
        id: bruno,
        source: { system: "bamboo_api", id: "102" },
        display_name: "Bruno Pérez",
      },
      title: "Meta de Bruno",
      percent_complete: 0,
      status: "in_progress",
      due_date: "2026-12-31",
    });
    expect(g.milestones).toEqual([
      expect.objectContaining({
        title: "Hito 1",
        source: { system: "bamboo_api", id: "m1" },
      }),
    ]);
    expect(g.shared_with.map((s: Json) => s.id)).toEqual([ana]);
    expect(g.created_at).toMatch(ISO);
  });

  it("filters by person and status, and pages", async () => {
    const mine = await call(listGoalsRoute, `/api/v1/goals?person_id=${bruno}`);
    expect(mine.body.data.map((g: Json) => g.id)).toEqual([brunoGoal]);
    const none = await call(listGoalsRoute, "/api/v1/goals?status=completed");
    expect(none.body.data).toEqual([]);
    const whole = await call(listGoalsRoute, "/api/v1/goals?limit=200");
    expect(await walk(listGoalsRoute, "/api/v1/goals", 1)).toEqual(
      whole.body.data.map((g: Json) => g.id),
    );
  });

  it("serves a person's goals under /people/{id}/goals", async () => {
    const res = await call(
      personGoalsRoute,
      `/api/v1/people/${bruno}/goals`,
      bruno,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.map((g: Json) => g.id)).toEqual([brunoGoal]);
    const unknown = await call(
      personGoalsRoute,
      "/api/v1/people/00000000-0000-4000-8000-000000000000/goals",
      "00000000-0000-4000-8000-000000000000",
    );
    expect(unknown.status).toBe(404);
  });

  it.each(["person_id=garbage", "status=bogus"])(
    "answers 400 for %s",
    async (q) => {
      const res = await call(listGoalsRoute, `/api/v1/goals?${q}`);
      expect(res.status).toBe(400);
      expect(res.type).toBe("application/problem+json");
    },
  );
});

describe("cycles", () => {
  it("lists cycles with their active participant count", async () => {
    const res = await call(listCyclesRoute, "/api/v1/cycles");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: cycleId,
      name: "Ciclo 2025",
      status: "draft",
      period_start: "2025-01-01",
      period_end: "2025-06-30",
      snapshot_date: "2025-06-01",
      participant_count: 2,
      source: null,
    });
    expect(res.body.data[0].components).toMatchObject({ self: true });
  });

  it("returns participants with their frozen snapshot, removed ones included", async () => {
    const res = await call(getCycleRoute, `/api/v1/cycles/${cycleId}`, cycleId);
    expect(res.status).toBe(200);
    const participants = res.body.data.participants as Json[];
    expect(participants).toHaveLength(3);
    const byPerson = new Map(participants.map((p) => [p.person.id, p]));
    expect(byPerson.get(bruno)).toMatchObject({
      person: { source: { system: "bamboo_api", id: "102" } },
      snapshot: {
        as_of: "2025-06-01",
        manager: { id: ana, source: { system: "bamboo_api", id: "101" } },
        department: "Tecnología",
        job_title: "Developer",
      },
      removed_at: null,
    });
    expect(byPerson.get(ana)!.snapshot.manager).toBeNull();
    expect(byPerson.get(carla)!.removed_at).toMatch(ISO);
    expect(byPerson.get(bruno)!.id).toMatch(UUID);
  });

  it("answers 404 for an unknown cycle", async () => {
    const res = await call(getCycleRoute, "/api/v1/cycles/nope", "nope");
    expect(res.status).toBe(404);
    expect(res.type).toBe("application/problem+json");
  });
});

describe("ingest runs", () => {
  it("lists runs newest first, filters and pages", async () => {
    const res = await call(listRunsRoute, "/api/v1/ingest-runs?limit=200");
    expect(res.status).toBe(200);
    const ids = res.body.data.map((r: Json) => r.id);
    expect(ids.slice(0, 5)).toEqual([rejectRun, ...[...runIds].reverse()]);
    expect(res.body.data[0]).toMatchObject({
      id: rejectRun,
      source_system: "bamboo_api",
      adapter: "fixture",
      entity: "employee",
      status: "succeeded",
      counts: { read: 3, inserted: 2, rejected: 1 },
      issue_count: 1,
    });
    expect(res.body.data[0].started_at).toMatch(ISO);

    const failed = await call(
      listRunsRoute,
      "/api/v1/ingest-runs?status=error",
    );
    expect(failed.body.data.map((r: Json) => r.id)).toEqual([
      runIds[3],
      runIds[1],
    ]);
    const goals = await call(listRunsRoute, "/api/v1/ingest-runs?entity=goal");
    expect(goals.body.data.map((r: Json) => r.id)).toEqual([
      runIds[3],
      runIds[2],
    ]);

    expect(await walk(listRunsRoute, "/api/v1/ingest-runs", 2)).toEqual(ids);
    expect(
      (await call(listRunsRoute, "/api/v1/ingest-runs?status=bogus")).status,
    ).toBe(400);
  });

  it("returns a run with params, rejects and raw record count", async () => {
    const res = await call(
      getRunRoute,
      `/api/v1/ingest-runs/${rejectRun}`,
      rejectRun,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: rejectRun,
      params: { entity: "employee" },
      rejects: [{ sourceId: "77", reason: "unknown employee" }],
      raw_record_count: 0,
    });
    expect(
      (await call(getRunRoute, "/api/v1/ingest-runs/nope", "nope")).status,
    ).toBe(404);
    expect(
      (
        await call(
          getRunRoute,
          "/api/v1/ingest-runs/00000000-0000-4000-8000-000000000000",
          "00000000-0000-4000-8000-000000000000",
        )
      ).status,
    ).toBe(404);
  });
});

describe("identity issues", () => {
  it("lists issues with source ids, filtered by status", async () => {
    const open = await call(
      listIdentityIssuesRoute,
      "/api/v1/identity-issues?status=open",
    );
    expect(open.body.data.map((i: Json) => i.id)).toEqual([issueOpen]);
    expect(open.body.data[0]).toMatchObject({
      source: { system: "bamboo_api", id: "900" },
      entity: "employee",
      reason: "ambiguous",
      status: "open",
      ingest_run_id: rejectRun,
      candidates: [],
      resolved_at: null,
      payload: { displayName: "Sin Resolver" },
    });
    const all = await call(listIdentityIssuesRoute, "/api/v1/identity-issues");
    expect(all.body.data.map((i: Json) => i.id).sort()).toEqual(
      [issueOpen, issueResolved].sort(),
    );
    expect(
      await walk(listIdentityIssuesRoute, "/api/v1/identity-issues", 1),
    ).toEqual(all.body.data.map((i: Json) => i.id));
    expect(
      (await call(listIdentityIssuesRoute, "/api/v1/identity-issues?status=x"))
        .status,
    ).toBe(400);
  });
});

describe("API_TOKEN gate", () => {
  it("is open when API_TOKEN is unset", async () => {
    vi.stubEnv("API_TOKEN", "");
    expect((await call(listPeopleRoute, "/api/v1/people?limit=1")).status).toBe(
      200,
    );
  });

  it("requires the bearer token on every endpoint when set", async () => {
    vi.stubEnv("API_TOKEN", "s3cret");
    for (const [route, path, id] of [
      [listPeopleRoute, "/api/v1/people", undefined],
      [getPersonRoute, `/api/v1/people/${bruno}`, bruno],
      [orgAsOfRoute, "/api/v1/org/as-of", undefined],
      [listGoalsRoute, "/api/v1/goals", undefined],
      [listCyclesRoute, "/api/v1/cycles", undefined],
      [listRunsRoute, "/api/v1/ingest-runs", undefined],
      [listIdentityIssuesRoute, "/api/v1/identity-issues", undefined],
    ] as const) {
      const denied = await call(route as Route, path, id);
      expect([path, denied.status]).toEqual([path, 401]);
      const allowed = await call(route as Route, path, id, {
        Authorization: "Bearer s3cret",
      });
      expect([path, allowed.status]).toEqual([path, 200]);
    }
  });
});
