import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { employeeJobHistory, person, questionRevision } from "@/db/schema";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import {
  addQuestion,
  cloneTemplate,
  getTemplate,
  listTemplates,
  seedSystemTemplates,
  updateQuestion,
} from "@/modules/templates";
import {
  addParticipant,
  createCycle,
  CyclesError,
  getCycle,
  launchCycle,
  listCycles,
  previewParticipants,
  removeParticipant,
  transition,
  updateCycle,
  type CycleInput,
} from ".";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

let ana: string;
let bruno: string;
let carla: string;
let templateId: string;

async function reset() {
  await db.execute(
    sql`TRUNCATE review_cycle, employee_job_history, employee_status_history, source_identity, employment, person, raw_record, ingest_run CASCADE`,
  );
}

const idOf = async (name: string) =>
  (
    await db
      .select({ id: person.id })
      .from(person)
      .where(eq(person.displayName, name))
  )[0].id;

beforeAll(async () => {
  await seedSystemTemplates(db);
  templateId = (await listTemplates(db)).find(
    (t) => t.isSystem && t.enabled,
  )!.id;
});

beforeEach(async () => {
  await reset();
  const dir = await mkdtemp(path.join(tmpdir(), "cycles-"));
  await cp(FIXTURES, dir, { recursive: true });
  const adapter = new FixtureAdapter(dir);
  await runIngest({ adapter, entity: "employee", db });
  await runIngest({ adapter, entity: "job_history", db });
  await rm(dir, { recursive: true, force: true });
  [ana, bruno, carla] = await Promise.all(
    ["Ana García", "Bruno Pérez", "Carla Romero"].map(idOf),
  );
});

afterAll(async () => {
  await reset();
  await closeDb();
});

function input(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    name: "H1 2022",
    periodStart: "2022-01-01",
    periodEnd: "2022-06-30",
    snapshotDate: "2022-06-01",
    components: {
      self: true,
      manager: true,
      peer: true,
      upward: false,
      calibration: true,
    },
    anonymity: { peer: "anonymous_to_employee", upward: "fully_anonymous" },
    templateId,
    dueDates: { nominations: "2022-07-05", self: "2022-07-15" },
    participantFilter: { kind: "people", personIds: [ana, bruno, carla] },
    ...overrides,
  };
}

describe("launchCycle", () => {
  it("freezes each participant's manager and job as of the snapshot date", async () => {
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);

    // Bruno's manager changes after the launch: the snapshot must not move.
    await db
      .update(employeeJobHistory)
      .set({ managerPersonId: ana, department: "Ventas" })
      .where(
        and(
          eq(employeeJobHistory.personId, bruno),
          eq(employeeJobHistory.validFrom, "2021-07-15"),
        ),
      );

    const detail = await getCycle(db, cycle.id);
    expect(detail?.status).toBe("nominations");
    const byId = new Map(
      detail!.participants.map((p) => [p.revieweePersonId, p]),
    );
    expect(byId.get(bruno)).toMatchObject({
      snapManagerPersonId: carla,
      snapManagerName: "Carla Romero",
      snapDepartment: "Ingeniería",
      snapJobTitle: "Developer",
      snapLocation: "Rosario",
      snapshotAsOf: "2022-06-01",
    });
    expect(byId.get(bruno)?.snapJobHistoryId).toBeTruthy();
    expect(byId.get(carla)?.snapManagerPersonId).toBe(ana);
  });

  it("flags participants without a manager in the snapshot", async () => {
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    const detail = await getCycle(db, cycle.id);
    const flagged = detail!.participants.filter((p) => p.withoutManager);
    expect(flagged.map((p) => p.revieweePersonId)).toEqual([ana]);
    expect(detail!.stats).toEqual({ active: 3, removed: 0, withoutManager: 1 });
  });

  it("launches the same people the preview counted", async () => {
    const filter = { kind: "all" } as const;
    const preview = await previewParticipants(db, filter);
    // Carla is terminated: "all" means current employees.
    expect(preview.count).toBe(2);
    const cycle = await createCycle(db, input({ participantFilter: filter }));
    await launchCycle(db, cycle.id, null);
    const detail = await getCycle(db, cycle.id);
    expect(detail!.participants.map((p) => p.revieweePersonId).sort()).toEqual(
      preview.sample.map((p) => p.personId).sort(),
    );
    expect((await listCycles(db))[0].participantCount).toBe(2);
  });

  it("filters by current job attributes and employment status", async () => {
    const byLocation = await previewParticipants(db, {
      kind: "filter",
      locations: ["Rosario"],
    });
    expect(byLocation.sample.map((p) => p.displayName)).toEqual([
      "Bruno Pérez",
    ]);
    const inactive = await previewParticipants(db, {
      kind: "filter",
      statuses: ["Inactive"],
    });
    expect(inactive.sample.map((p) => p.displayName)).toEqual(["Carla Romero"]);
  });

  it("starts in collecting when peers are disabled", async () => {
    const cycle = await createCycle(
      db,
      input({
        components: {
          self: true,
          manager: true,
          peer: false,
          upward: false,
          calibration: false,
        },
      }),
    );
    expect((await launchCycle(db, cycle.id, ana)).status).toBe("collecting");
  });

  it("copies template questions as immutable revisions", async () => {
    const template = await cloneTemplate(db, templateId);
    const detail = await getTemplate(db, template.id);
    const section = detail!.sections[0];
    const q = await addQuestion(db, section.id, {
      kind: "text",
      appliesTo: ["self"],
      prompt: { es: "Original", en: "Original" },
    });
    const cycle = await createCycle(db, input({ templateId: template.id }));
    await launchCycle(db, cycle.id, null);

    await updateQuestion(db, q.id, {
      kind: "text",
      appliesTo: ["self"],
      prompt: { es: "Editada", en: "Edited" },
    });

    const revisions = await db
      .select()
      .from(questionRevision)
      .where(eq(questionRevision.cycleId, cycle.id));
    const copied = revisions.find((r) => r.questionId === q.id);
    expect(copied?.prompt).toEqual({ es: "Original", en: "Original" });
    expect(copied?.sectionTitle).toEqual(section.title);
    const total = detail!.sections.reduce((n, s) => n + s.questions.length, 0);
    expect(revisions).toHaveLength(total + 1);
    expect(revisions.some((r) => r.scale?.options.length)).toBe(true);
  });

  it("refuses to launch twice or without participants", async () => {
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    await expect(launchCycle(db, cycle.id, null)).rejects.toMatchObject({
      code: "not_draft",
    });
    const empty = await createCycle(
      db,
      input({ participantFilter: { kind: "filter", locations: ["Marte"] } }),
    );
    await expect(launchCycle(db, empty.id, null)).rejects.toMatchObject({
      code: "no_participants",
    });
  });
});

describe("createCycle / updateCycle", () => {
  it("rejects phase due dates out of order", async () => {
    await expect(
      createCycle(
        db,
        input({ dueDates: { self: "2022-07-15", manager: "2022-07-01" } }),
      ),
    ).rejects.toMatchObject({
      code: "validation",
      issues: [{ path: "dueDates.manager", message: "date_order" }],
    });
  });

  it("only allows name and due dates once launched", async () => {
    const cycle = await createCycle(db, input());
    const edited = await updateCycle(db, cycle.id, {
      snapshotDate: "2022-05-01",
    });
    expect(edited.snapshotDate).toBe("2022-05-01");
    await launchCycle(db, cycle.id, null);
    await expect(
      updateCycle(db, cycle.id, { snapshotDate: "2022-06-01" }),
    ).rejects.toBeInstanceOf(CyclesError);
    const renamed = await updateCycle(db, cycle.id, {
      name: "H1",
      dueDates: { self: "2022-08-01" },
    });
    expect(renamed).toMatchObject({
      name: "H1",
      dueDates: { self: "2022-08-01" },
    });
  });
});

describe("transition", () => {
  it("rejects invalid transitions and logs valid ones with the actor", async () => {
    const cycle = await createCycle(db, input());
    await expect(
      transition(db, cycle.id, "collecting", ana),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    await launchCycle(db, cycle.id, ana);
    await expect(
      transition(db, cycle.id, "calibration", ana),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    await transition(db, cycle.id, "collecting", ana, "go");
    await transition(db, cycle.id, "nominations", bruno);

    const detail = await getCycle(db, cycle.id);
    expect(detail!.status).toBe("nominations");
    expect(
      detail!.transitions.map((t) => [t.fromStatus, t.toStatus, t.actorName]),
    ).toEqual([
      ["draft", "nominations", "Ana García"],
      ["nominations", "collecting", "Ana García"],
      ["collecting", "nominations", "Bruno Pérez"],
    ]);
    expect(detail!.transitions[1].note).toBe("go");
  });

  it("treats closed as terminal", async () => {
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    for (const to of [
      "collecting",
      "manager_review",
      "calibration",
      "sharing",
      "closed",
    ] as const) {
      await transition(db, cycle.id, to, null);
    }
    await expect(
      transition(db, cycle.id, "sharing", null),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });
});

describe("mid-cycle participants", () => {
  it("snapshots an added participant at the add date", async () => {
    const cycle = await createCycle(
      db,
      input({ participantFilter: { kind: "people", personIds: [ana] } }),
    );
    await launchCycle(db, cycle.id, null);
    // Added in 2023: Bruno reports to Ana by then (not Carla, as on snapshot_date).
    await addParticipant(db, cycle.id, bruno, "2023-03-01");
    const detail = await getCycle(db, cycle.id);
    expect(
      detail!.participants.find((p) => p.revieweePersonId === bruno),
    ).toMatchObject({
      snapManagerPersonId: ana,
      snapJobTitle: "Senior Developer",
      snapshotAsOf: "2023-03-01",
    });
    await expect(
      addParticipant(db, cycle.id, bruno, "2023-03-01"),
    ).rejects.toMatchObject({ code: "already_participant" });
  });

  it("removing keeps the row with removed_at", async () => {
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    await removeParticipant(db, cycle.id, bruno);
    const detail = await getCycle(db, cycle.id);
    const removed = detail!.participants.find(
      (p) => p.revieweePersonId === bruno,
    );
    expect(removed?.removedAt).toBeInstanceOf(Date);
    expect(removed?.snapManagerPersonId).toBe(carla);
    expect(detail!.stats).toMatchObject({ active: 2, removed: 1 });
  });

  it("rejects changes to participants of a draft", async () => {
    const cycle = await createCycle(db, input());
    await expect(addParticipant(db, cycle.id, bruno)).rejects.toMatchObject({
      code: "not_active",
    });
  });
});
