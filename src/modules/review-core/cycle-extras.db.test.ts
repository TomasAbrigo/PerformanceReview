import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import {
  cycleParticipant,
  cycleTemplateGroup,
  employeeJobHistory,
  employment,
  goal,
  participantGoalSnapshot,
  person,
  questionRevision,
  type Relationship,
  reviewCycle,
  reviewTemplate,
} from "@/db/schema";
import { FixtureAdapter, runIngest } from "@/modules/ingest";
import { todayLocal } from "@/modules/org-history/dates";
import {
  addQuestion,
  cloneTemplate,
  getTemplate,
  listScales,
  listTemplates,
  seedSystemTemplates,
  updateQuestion,
} from "@/modules/templates";
import {
  addParticipant,
  createCycle,
  CyclesError,
  duplicateCycle,
  questionsFor,
  enrollAllDueParticipants,
  enrollDueParticipants,
  findMySelfRequestId,
  getCycle,
  getSelfReview,
  launchCycle,
  listCycleGroups,
  listCycles,
  listMyTasks,
  previewGroups,
  recentHires,
  removeParticipant,
  saveDraft,
  setCycleGroups,
  transition,
  updateCycle,
  type CycleGroupInput,
  type CycleInput,
} from ".";
import type { ActorContext } from "@/modules/actor/types";
import { enrollCli } from "./enroll-cli";
import { addDays } from "./hire-date-schedule";

const FIXTURES = path.resolve("src/modules/bamboo-client/__fixtures__");

let ana: string;
let bruno: string;
let carla: string;
let defaultTemplate: string;
let engTemplate: string;
let salesTemplate: string;
let scaleId: string;

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

/** The copy of a cycle (the suffix comes from the caller's language). */
const dup = async (
  actor: string | null,
  cycleId: string,
  opts: { suffix: string } = { suffix: "Copia" },
) => (await duplicateCycle(db, actor, cycleId, opts)).cycle;

/** The questions a participant answers, as the forms read them. */
async function participantQuestions(
  cycleId: string,
  personId: string,
  relationship?: Relationship,
) {
  const [participant] = await db
    .select({ groupId: cycleParticipant.templateGroupId })
    .from(cycleParticipant)
    .where(
      and(
        eq(cycleParticipant.cycleId, cycleId),
        eq(cycleParticipant.revieweePersonId, personId),
      ),
    );
  return questionsFor(db, cycleId, participant.groupId, relationship);
}

/** Template that adds one distinguishing question to the system template. */
async function templateWith(prompt: string): Promise<string> {
  const template = await cloneTemplate(db, defaultTemplate);
  const detail = await getTemplate(db, template.id);
  await addQuestion(db, detail!.sections[0].id, {
    kind: "text",
    appliesTo: ["self", "manager"],
    prompt: { es: prompt, en: prompt },
  });
  return template.id;
}

type Hire = {
  department?: string;
  terminatedOn?: string;
  /** Leave the job row open after the termination (an ingest that lags). */
  keepJobOpen?: boolean;
  /** No job history at all (it has not been ingested yet). */
  noJob?: boolean;
  /** Manager from the hire date until `managerChange`, then `newManager`. */
  manager?: string;
  managerChange?: { on: string; manager: string };
};

/** A person with a single employment and job history (no Bamboo ingest). */
async function hire(
  name: string,
  hireDate: string,
  opts: Hire = {},
): Promise<string> {
  const [p] = await db
    .insert(person)
    .values({ displayName: name })
    .returning({ id: person.id });
  await db.insert(employment).values({
    personId: p.id,
    hireDate,
    status: opts.terminatedOn ? "Inactive" : "Active",
    terminationDate: opts.terminatedOn ?? null,
    sourceSystem: "native",
    sourceId: name,
  });
  const job = {
    personId: p.id,
    department: opts.department ?? "Ingeniería",
    sourceSystem: "native" as const,
  };
  const closedAt = opts.keepJobOpen ? null : (opts.terminatedOn ?? null);
  if (opts.noJob) return p.id;
  await db.insert(employeeJobHistory).values({
    ...job,
    validFrom: hireDate,
    validTo: opts.managerChange?.on ?? closedAt,
    managerPersonId: opts.manager ?? null,
    sourceId: `${name}-1`,
  });
  if (opts.managerChange) {
    await db.insert(employeeJobHistory).values({
      ...job,
      validFrom: opts.managerChange.on,
      // A terminated person has no job row after the termination date.
      validTo: closedAt,
      managerPersonId: opts.managerChange.manager,
      sourceId: `${name}-2`,
    });
  }
  return p.id;
}

beforeAll(async () => {
  await seedSystemTemplates(db);
  defaultTemplate = (await listTemplates(db)).find(
    (t) => t.isSystem && t.enabled,
  )!.id;
  scaleId = (await listScales(db))[0].id;
});

beforeEach(async () => {
  await reset();
  const dir = await mkdtemp(path.join(tmpdir(), "cycle-extras-"));
  await cp(FIXTURES, dir, { recursive: true });
  const adapter = new FixtureAdapter(dir);
  await runIngest({ adapter, entity: "employee", db });
  await runIngest({ adapter, entity: "job_history", db });
  await rm(dir, { recursive: true, force: true });
  [ana, bruno, carla] = await Promise.all(
    ["Ana García", "Bruno Pérez", "Carla Romero"].map(idOf),
  );
  engTemplate = await templateWith("Pregunta de Ingeniería");
  salesTemplate = await templateWith("Pregunta de Ventas");
});

afterAll(async () => {
  await reset();
  await closeDb();
});

function input(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    name: "H1 2022",
    description: "Primer semestre",
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
    templateId: defaultTemplate,
    finalScaleId: scaleId,
    dueDates: { nominations: "2022-07-05", self: "2022-07-15" },
    participantFilter: { kind: "people", personIds: [ana, bruno, carla] },
    ...overrides,
  };
}

const as = (personId: string): ActorContext => ({
  personId,
  role: "employee",
});

const promptsOf = (rows: { prompt: { es: string } }[]) =>
  rows.map((r) => r.prompt.es);

// -------------------------------------------------------------- duplicate

describe("duplicateCycle", () => {
  it("copies a launched cycle as an independent draft", async () => {
    const original = await createCycle(db, input());
    await setCycleGroups(db, original.id, [
      {
        name: "Ingeniería",
        templateId: engTemplate,
        filter: { kind: "filter", departments: ["Ingeniería"] },
      },
    ]);
    await launchCycle(db, original.id, null);

    const copy = await dup(ana, original.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy).toMatchObject({
      name: "H1 2022 (Copia)",
      description: "Primer semestre",
      status: "draft",
      launchedAt: null,
      periodStart: "2022-01-01",
      periodEnd: "2022-06-30",
      snapshotDate: "2022-06-01",
      components: original.components,
      anonymity: original.anonymity,
      templateId: defaultTemplate,
      finalScaleId: scaleId,
      // Due dates are copied as they are: the admin has to edit them.
      dueDates: { nominations: "2022-07-05", self: "2022-07-15" },
      participantFilter: original.participantFilter,
      scheduleKind: "fixed",
      sourceSystem: "native",
      sourceId: null,
    });

    const detail = await getCycle(db, copy.id);
    expect(detail!.participants).toEqual([]);
    expect(detail!.questionCount).toBe(0);
    const groups = await listCycleGroups(db, copy.id);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      name: "Ingeniería",
      templateId: engTemplate,
      filter: { kind: "filter", departments: ["Ingeniería"] },
      participantCount: 0,
    });
    const [originalGroup] = await listCycleGroups(db, original.id);
    expect(groups[0].id).not.toBe(originalGroup.id);
    // Bruno and Carla worked in Ingeniería on the snapshot date.
    expect(originalGroup.participantCount).toBe(2);
  });

  it("logs who duplicated it and from which cycle", async () => {
    const original = await createCycle(db, input());
    const copy = await dup(ana, original.id);
    const detail = await getCycle(db, copy.id);
    expect(detail!.transitions).toMatchObject([
      {
        fromStatus: "draft",
        toStatus: "draft",
        actorName: "Ana García",
        note: `duplicate_of:${original.id}`,
      },
    ]);
  });

  it("uses the given suffix and can be repeated", async () => {
    const original = await createCycle(db, input());
    const copy = await dup(null, original.id, {
      suffix: "Copy",
    });
    expect(copy.name).toBe("H1 2022 (Copy)");
    const again = await dup(null, original.id);
    expect(again.name).toBe("H1 2022 (Copia)");
    expect(await listCycles(db)).toHaveLength(3);
  });

  it("editing the copy never touches the original", async () => {
    const original = await createCycle(db, input());
    await setCycleGroups(db, original.id, [
      {
        name: "Ingeniería",
        templateId: engTemplate,
        filter: { kind: "filter", departments: ["Ingeniería"] },
      },
    ]);
    const copy = await dup(null, original.id);

    await updateCycle(db, copy.id, {
      name: "H2 2022",
      components: {
        self: true,
        manager: false,
        peer: false,
        upward: false,
        calibration: false,
      },
      anonymity: { peer: "transparent", upward: "transparent" },
      dueDates: { self: "2022-12-31" },
      participantFilter: { kind: "all" },
      templateId: salesTemplate,
    });
    await setCycleGroups(db, copy.id, [
      {
        name: "Ventas",
        templateId: salesTemplate,
        filter: { kind: "filter", departments: ["Ventas"] },
      },
    ]);

    const [after] = await db
      .select()
      .from(reviewCycle)
      .where(eq(reviewCycle.id, original.id));
    expect(after).toEqual(original);
    const groups = await listCycleGroups(db, original.id);
    expect(groups.map((g) => g.name)).toEqual(["Ingeniería"]);
    expect(groups[0].templateId).toBe(engTemplate);
  });

  it("editing the original never touches the copy", async () => {
    const original = await createCycle(db, input());
    const copy = await dup(null, original.id);
    await updateCycle(db, original.id, {
      name: "Otro",
      dueDates: { self: "2022-09-09" },
    });
    await launchCycle(db, original.id, null);
    const [after] = await db
      .select()
      .from(reviewCycle)
      .where(eq(reviewCycle.id, copy.id));
    expect(after).toEqual(copy);
    expect((await getCycle(db, copy.id))!.participants).toEqual([]);
  });

  it("copies the hire-date schedule", async () => {
    const original = await createCycle(
      db,
      input({
        scheduleKind: "hire_date",
        hireDateSchedule: { milestoneDays: 90, windowWeeks: 3 },
        participantFilter: { kind: "all" },
      }),
    );
    const copy = await dup(null, original.id);
    expect(copy).toMatchObject({
      scheduleKind: "hire_date",
      hireDateSchedule: { milestoneDays: 90, windowWeeks: 3 },
    });
  });

  it("works on cycles in any status, and fails on unknown ids", async () => {
    const original = await createCycle(db, input());
    await launchCycle(db, original.id, null);
    for (const to of [
      "collecting",
      "manager_review",
      "calibration",
      "sharing",
      "closed",
    ] as const) {
      await transition(db, original.id, to, null);
    }
    expect((await dup(null, original.id)).status).toBe("draft");
    await expect(
      dup(null, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(dup(null, "nope")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("needs the suffix from the caller: it is a translated word", async () => {
    const original = await createCycle(db, input());
    for (const suffix of ["", "   "]) {
      await expect(
        duplicateCycle(db, null, original.id, { suffix }),
      ).rejects.toMatchObject({
        code: "validation",
        issues: [{ path: "suffix", message: "required" }],
      });
    }
    // A very long suffix is cut, not stored as is.
    const copy = await dup(null, original.id, { suffix: "x".repeat(60) });
    expect(copy.name).toBe(`H1 2022 (${"x".repeat(40)})`);
    expect(await listCycles(db)).toHaveLength(2);
  });

  it("does not copy templates that are deleted or disabled, and says so", async () => {
    const base = await templateWith("Base");
    const keep = await templateWith("Se queda");
    const deleted = await templateWith("Borrada");
    const disabled = await templateWith("Apagada");
    const original = await createCycle(db, input({ templateId: base }));
    await setCycleGroups(db, original.id, [
      { name: "Borrado", templateId: deleted, filter: { kind: "all" } },
      { name: "Se queda", templateId: keep, filter: { kind: "all" } },
      { name: "Apagado", templateId: disabled, filter: { kind: "all" } },
    ]);
    await db
      .update(reviewTemplate)
      .set({ deletedAt: new Date() })
      .where(eq(reviewTemplate.id, deleted));
    await db
      .update(reviewTemplate)
      .set({ enabled: false })
      .where(eq(reviewTemplate.id, disabled));
    await db
      .update(reviewTemplate)
      .set({ deletedAt: new Date() })
      .where(eq(reviewTemplate.id, base));

    const { cycle, warnings } = await duplicateCycle(db, null, original.id, {
      suffix: "Copia",
    });

    expect(cycle.templateId).toBeNull();
    expect(warnings).toEqual([
      { kind: "template" },
      { kind: "group", name: "Borrado" },
      { kind: "group", name: "Apagado" },
    ]);
    const groups = await listCycleGroups(db, cycle.id);
    expect(groups.map((g) => [g.name, g.sort, g.templateId])).toEqual([
      ["Se queda", 0, keep],
    ]);
    // The original keeps its configuration untouched.
    expect((await listCycleGroups(db, original.id)).map((g) => g.name)).toEqual(
      ["Borrado", "Se queda", "Apagado"],
    );
  });

  it("has no warnings when everything it references is available", async () => {
    const original = await createCycle(db, input());
    const result = await duplicateCycle(db, null, original.id, {
      suffix: "Copia",
    });
    expect(result.warnings).toEqual([]);
    expect(result.cycle.templateId).toBe(defaultTemplate);
  });

  it("launches the copy without affecting the original's participants", async () => {
    const original = await createCycle(db, input());
    await launchCycle(db, original.id, null);
    const copy = await dup(null, original.id);
    await removeParticipant(db, original.id, bruno);
    await launchCycle(db, copy.id, null);
    const [o, c] = await Promise.all([
      getCycle(db, original.id),
      getCycle(db, copy.id),
    ]);
    expect(o!.stats).toMatchObject({ active: 2, removed: 1 });
    expect(c!.stats).toMatchObject({ active: 3, removed: 0 });
  });
});

// ---------------------------------------------------------------- groups

describe("template groups", () => {
  let engGroup: CycleGroupInput;
  beforeEach(() => {
    engGroup = {
      name: "Ingeniería",
      templateId: engTemplate,
      filter: { kind: "filter", departments: ["Ingeniería"] },
    };
  });

  it("gives each group its own questions and falls back to the default", async () => {
    const cycle = await createCycle(db, input());
    await setCycleGroups(db, cycle.id, [engGroup]);
    await launchCycle(db, cycle.id, null);

    const detail = await getCycle(db, cycle.id);
    const [group] = await listCycleGroups(db, cycle.id);
    const byPerson = new Map(
      detail!.participants.map((p) => [p.revieweePersonId, p.templateGroupId]),
    );
    // Bruno works in Ingeniería (group); Ana (Dirección) has no group.
    expect(byPerson.get(bruno)).toBe(group.id);
    expect(byPerson.get(ana)).toBeNull();

    const brunoQuestions = await participantQuestions(cycle.id, bruno);
    const anaQuestions = await participantQuestions(cycle.id, ana);
    expect(promptsOf(brunoQuestions)).toContain("Pregunta de Ingeniería");
    expect(promptsOf(anaQuestions)).not.toContain("Pregunta de Ingeniería");
    // Same base questions, one extra for the group.
    expect(brunoQuestions).toHaveLength(anaQuestions.length + 1);
    expect(brunoQuestions.every((q) => q.groupId === group.id)).toBe(true);
    expect(anaQuestions.every((q) => q.groupId === null)).toBe(true);
    // A participant matching no group uses the cycle's default template.
    expect(detail!.templateId).toBe(defaultTemplate);
  });

  it("filters by relationship for the self and manager forms", async () => {
    const cycle = await createCycle(db, input());
    await setCycleGroups(db, cycle.id, [engGroup]);
    await launchCycle(db, cycle.id, null);
    const self = await participantQuestions(cycle.id, bruno, "self");
    const peer = await participantQuestions(cycle.id, bruno, "peer");
    expect(self.every((q) => q.appliesTo.includes("self"))).toBe(true);
    expect(promptsOf(self)).toContain("Pregunta de Ingeniería");
    expect(promptsOf(peer)).not.toContain("Pregunta de Ingeniería");
  });

  it("copies several groups with different questions", async () => {
    const cycle = await createCycle(db, input());
    await setCycleGroups(db, cycle.id, [
      engGroup,
      {
        name: "Dirección",
        templateId: salesTemplate,
        filter: { kind: "filter", departments: ["Dirección"] },
      },
    ]);
    await launchCycle(db, cycle.id, null);
    const eng = promptsOf(await participantQuestions(cycle.id, bruno));
    const dir = promptsOf(await participantQuestions(cycle.id, ana));
    expect(eng).toContain("Pregunta de Ingeniería");
    expect(eng).not.toContain("Pregunta de Ventas");
    expect(dir).toContain("Pregunta de Ventas");
    expect(dir).not.toContain("Pregunta de Ingeniería");
  });

  it("sends a person to the first matching group by order", async () => {
    const byLocation: CycleGroupInput = {
      name: "Rosario",
      templateId: salesTemplate,
      filter: { kind: "filter", locations: ["Rosario"] },
    };

    const first = await createCycle(db, input());
    await setCycleGroups(db, first.id, [engGroup, byLocation]);
    await launchCycle(db, first.id, null);
    expect(promptsOf(await participantQuestions(first.id, bruno))).toContain(
      "Pregunta de Ingeniería",
    );

    const second = await createCycle(db, input());
    await setCycleGroups(db, second.id, [byLocation, engGroup]);
    await launchCycle(db, second.id, null);
    const prompts = promptsOf(await participantQuestions(second.id, bruno));
    expect(prompts).toContain("Pregunta de Ventas");
    expect(prompts).not.toContain("Pregunta de Ingeniería");
  });

  it("freezes the group questions at launch", async () => {
    const cycle = await createCycle(db, input());
    await setCycleGroups(db, cycle.id, [engGroup]);
    await launchCycle(db, cycle.id, null);
    const template = await getTemplate(db, engTemplate);
    const added = template!.sections[0].questions.find(
      (q) => q.prompt.es === "Pregunta de Ingeniería",
    )!;
    await updateQuestion(db, added.id, {
      kind: "text",
      appliesTo: ["self"],
      prompt: { es: "Editada", en: "Edited" },
    });
    expect(promptsOf(await participantQuestions(cycle.id, bruno))).toContain(
      "Pregunta de Ingeniería",
    );
  });

  it("refuses to launch with a deleted template instead of freezing no questions", async () => {
    const template = await templateWith("Pronto borrada");
    const cycle = await createCycle(db, input({ templateId: template }));
    await db
      .update(reviewTemplate)
      .set({ deletedAt: new Date() })
      .where(eq(reviewTemplate.id, template));
    await expect(launchCycle(db, cycle.id, null)).rejects.toMatchObject({
      code: "no_template",
    });

    // Same for a group's template; the launch is all or nothing.
    const other = await createCycle(db, input());
    await setCycleGroups(db, other.id, [engGroup]);
    await db
      .update(reviewTemplate)
      .set({ deletedAt: new Date() })
      .where(eq(reviewTemplate.id, engTemplate));
    await expect(launchCycle(db, other.id, null)).rejects.toMatchObject({
      code: "no_template",
    });
    const detail = await getCycle(db, other.id);
    expect(detail!.status).toBe("draft");
    expect(detail!.participants).toEqual([]);
  });

  it("gives the detail the name of the cycle's template", async () => {
    const cycle = await createCycle(db, input());
    const detail = await getCycle(db, cycle.id);
    expect(detail!.defaultTemplateName).toEqual(
      (await getTemplate(db, defaultTemplate))!.name,
    );
    const none = await createCycle(db, input({ templateId: null }));
    expect((await getCycle(db, none.id))!.defaultTemplateName).toBeNull();
  });

  it("limits how many groups a preview computes", async () => {
    const filter = { kind: "all" } as const;
    const many = (n: number) =>
      Array.from({ length: n }, () => ({
        filter: { kind: "all" } as const,
      }));
    await expect(
      previewGroups(db, filter, many(21), "2022-06-01"),
    ).rejects.toMatchObject({ code: "validation" });
    const ok = await previewGroups(db, filter, many(20), "2022-06-01");
    expect(ok.groups).toHaveLength(20);
    // The first group takes everyone; the rest get nobody.
    expect(ok.groups[0]).toBe(3);
    expect(ok.remainder).toBe(0);
  });

  it("serves the self form the questions of the participant's group", async () => {
    const cycle = await createCycle(db, input());
    await setCycleGroups(db, cycle.id, [engGroup]);
    await launchCycle(db, cycle.id, null);
    await transition(db, cycle.id, "collecting", null);

    const review = async (personId: string) => {
      const requestId = await findMySelfRequestId(db, as(personId), cycle.id);
      return getSelfReview(db, as(personId), requestId!);
    };
    const brunoReview = await review(bruno);
    const anaReview = await review(ana);
    expect(promptsOf(brunoReview!.questions)).toContain(
      "Pregunta de Ingeniería",
    );
    expect(promptsOf(anaReview!.questions)).not.toContain(
      "Pregunta de Ingeniería",
    );
    expect(brunoReview!.questions).toHaveLength(
      (await participantQuestions(cycle.id, bruno, "self")).length,
    );

    // Bruno cannot answer a question of the default template.
    const defaultQuestion = anaReview!.questions.find(
      (q) => q.kind === "text",
    )!;
    await expect(
      saveDraft(db, as(bruno), brunoReview!.request.id, [
        { questionRevisionId: defaultQuestion.id, value: "hola" },
      ]),
    ).rejects.toMatchObject({ code: "validation" });
    const own = brunoReview!.questions.find((q) => q.kind === "text")!;
    await saveDraft(db, as(bruno), brunoReview!.request.id, [
      { questionRevisionId: own.id, value: "hola" },
    ]);
    expect((await review(bruno))!.answers[own.id]).toBe("hola");
  });

  it("assigns the group of someone added mid-cycle", async () => {
    const cycle = await createCycle(
      db,
      input({ participantFilter: { kind: "people", personIds: [ana] } }),
    );
    await setCycleGroups(db, cycle.id, [engGroup]);
    await launchCycle(db, cycle.id, null);
    const added = await addParticipant(db, cycle.id, bruno, "2022-07-01");
    const [group] = await listCycleGroups(db, cycle.id);
    expect(added.templateGroupId).toBe(group.id);
    expect(promptsOf(await participantQuestions(cycle.id, bruno))).toContain(
      "Pregunta de Ingeniería",
    );
    expect(group.participantCount).toBe(1);
  });

  it("previews the people of each group and the remainder", async () => {
    const preview = await previewGroups(
      db,
      { kind: "people", personIds: [ana, bruno, carla] },
      [
        { filter: engGroup.filter },
        { filter: { kind: "filter", locations: ["Rosario"] } },
      ],
      "2022-06-01",
    );
    // Bruno and Carla (Ingeniería) go to the first group; the second one is
    // left with nobody and Ana (Dirección) with no group.
    expect(preview).toEqual({ total: 3, groups: [2, 0], remainder: 1 });
    // As of 2025 Carla is gone.
    const everyone = await previewGroups(db, { kind: "all" }, [], "2025-01-01");
    expect(everyone).toEqual({ total: 2, groups: [], remainder: 2 });
  });

  it("previews exactly what launch assigns", async () => {
    const groups: CycleGroupInput[] = [
      engGroup,
      {
        name: "Dirección",
        templateId: salesTemplate,
        filter: { kind: "filter", departments: ["Dirección"] },
      },
    ];
    const filter = { kind: "all" } as const;
    const preview = await previewGroups(
      db,
      filter,
      groups.map((g) => ({ filter: g.filter })),
      "2022-06-01",
    );
    const cycle = await createCycle(db, input({ participantFilter: filter }));
    await setCycleGroups(db, cycle.id, [...groups]);
    await launchCycle(db, cycle.id, null);
    const listed = await listCycleGroups(db, cycle.id);
    expect(listed.map((g) => g.participantCount)).toEqual(preview.groups);
    expect(preview.remainder).toBe(0);
  });

  it("replaces groups of a draft and refuses it after launch", async () => {
    const cycle = await createCycle(db, input());
    await setCycleGroups(db, cycle.id, [engGroup]);
    await setCycleGroups(db, cycle.id, []);
    expect(await listCycleGroups(db, cycle.id)).toEqual([]);
    await setCycleGroups(db, cycle.id, [engGroup]);
    await launchCycle(db, cycle.id, null);
    await expect(setCycleGroups(db, cycle.id, [])).rejects.toMatchObject({
      code: "not_draft",
    });
  });

  it("validates names, templates and filters", async () => {
    const cycle = await createCycle(db, input());
    await expect(
      setCycleGroups(db, cycle.id, [engGroup, engGroup]),
    ).rejects.toMatchObject({
      code: "validation",
      issues: [{ path: "1.name", message: "duplicate_name" }],
    });
    await expect(
      setCycleGroups(db, cycle.id, [
        { ...engGroup, templateId: "00000000-0000-4000-8000-000000000000" },
      ]),
    ).rejects.toMatchObject({
      code: "validation",
      issues: [{ path: "0.templateId", message: "invalid" }],
    });
    await expect(
      setCycleGroups(db, cycle.id, [
        { ...engGroup, filter: { kind: "people", personIds: [] } },
      ]),
    ).rejects.toBeInstanceOf(CyclesError);
    expect(await listCycleGroups(db, cycle.id)).toEqual([]);
  });

  it("lists groups in order with their counts and cascades on delete", async () => {
    const cycle = await createCycle(db, input());
    await setCycleGroups(db, cycle.id, [
      engGroup,
      { ...engGroup, name: "Otra", templateId: salesTemplate },
    ]);
    await launchCycle(db, cycle.id, null);
    const groups = await listCycleGroups(db, cycle.id);
    expect(groups.map((g) => [g.name, g.sort, g.participantCount])).toEqual([
      ["Ingeniería", 0, 2],
      ["Otra", 1, 0],
    ]);
    expect(groups[0].questionCount).toBeGreaterThan(0);
    await db.delete(reviewCycle).where(eq(reviewCycle.id, cycle.id));
    expect(await db.select().from(cycleTemplateGroup)).toEqual([]);
    expect(await db.select().from(questionRevision)).toEqual([]);
  });

  it("leaves cycles without groups as before", async () => {
    const cycle = await createCycle(db, input());
    await launchCycle(db, cycle.id, null);
    const rows = await db
      .select()
      .from(questionRevision)
      .where(eq(questionRevision.cycleId, cycle.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.groupId === null)).toBe(true);
    const participants = await db
      .select()
      .from(cycleParticipant)
      .where(eq(cycleParticipant.cycleId, cycle.id));
    expect(participants.every((p) => p.templateGroupId === null)).toBe(true);
  });
});

// ------------------------------------------------------------- hire date

const AS_OF = "2026-03-10";
const schedule = { milestoneDays: 30, windowWeeks: 2 } as const;

function hireDateCycle(overrides: Partial<CycleInput> = {}) {
  return createCycle(
    db,
    input({
      name: "Onboarding 30 días",
      scheduleKind: "hire_date",
      hireDateSchedule: schedule,
      participantFilter: { kind: "all" },
      dueDates: {},
      ...overrides,
    }),
  );
}

async function launched(overrides: Partial<CycleInput> = {}) {
  const cycle = await hireDateCycle(overrides);
  return launchCycle(db, cycle.id, null);
}

const enrolledNames = async (cycleId: string) =>
  (await getCycle(db, cycleId))!.participants.map((p) => p.displayName).sort();

describe("enrollDueParticipants", () => {
  let people: Record<string, string>;

  beforeEach(async () => {
    // Milestone (hire + 30 days) and window [asOf - 14, asOf] = [02-24, 03-10].
    people = {
      dana: await hire("Dana", "2026-01-31"), // milestone 03-02: in
      eli: await hire("Eli", "2026-02-01"), // 03-03: in
      ines: await hire("Ines", "2026-02-08"), // 03-10: in (upper end)
      joel: await hire("Joel", "2026-01-25"), // 02-24: in (lower end)
      fede: await hire("Fede", "2026-01-24"), // 02-23: window closed
      hana: await hire("Hana", "2026-02-09"), // 03-11: not yet
      gus: await hire("Gus", "2026-03-01"), // 03-31: not yet
      kai: await hire("Kai", "2026-02-01", { terminatedOn: "2026-03-05" }),
    };
  });

  it("enrolls exactly the people reaching the milestone within the window", async () => {
    const cycle = await launched();
    expect(await enrolledNames(cycle.id)).toEqual([]);

    const result = await enrollDueParticipants(db, cycle.id, AS_OF);

    expect(result.enrolled.map((e) => e.displayName).sort()).toEqual([
      "Dana",
      "Eli",
      "Ines",
      "Joel",
    ]);
    expect(await enrolledNames(cycle.id)).toEqual([
      "Dana",
      "Eli",
      "Ines",
      "Joel",
    ]);
  });

  it("snapshots the org as of the enrollment date and computes the due dates", async () => {
    const dana = await hire("Dana M", "2026-01-31", {
      manager: ana,
      managerChange: { on: "2026-03-05", manager: bruno },
    });
    const cycle = await launched();
    await enrollDueParticipants(db, cycle.id, AS_OF);

    const detail = await getCycle(db, cycle.id);
    const row = detail!.participants.find((p) => p.revieweePersonId === dana)!;
    // Manager on the enrollment date (Bruno), not on the milestone (Ana).
    expect(row).toMatchObject({
      snapshotAsOf: AS_OF,
      snapManagerPersonId: bruno,
      snapDepartment: "Ingeniería",
      // 2026-01-31 + 30 days = 2026-03-02; plus 2 weeks.
      dueDates: { self: "2026-03-16", manager: "2026-03-16" },
      removedAt: null,
    });
    const ines = detail!.participants.find(
      (p) => p.revieweePersonId === people.ines,
    );
    expect(ines?.dueDates).toEqual({
      self: "2026-03-24",
      manager: "2026-03-24",
    });
  });

  it("returns who was enrolled with their milestone and deadline", async () => {
    const cycle = await launched();
    const result = await enrollDueParticipants(db, cycle.id, AS_OF);
    expect(result.asOf).toBe(AS_OF);
    expect(result.enrolled.find((e) => e.personId === people.dana)).toEqual({
      personId: people.dana,
      displayName: "Dana",
      hireDate: "2026-01-31",
      milestoneDate: "2026-03-02",
      dueDates: { self: "2026-03-16", manager: "2026-03-16" },
    });
  });

  it("is idempotent and picks up later milestones on later runs", async () => {
    const cycle = await launched();
    await enrollDueParticipants(db, cycle.id, AS_OF);
    const again = await enrollDueParticipants(db, cycle.id, AS_OF);
    expect(again.enrolled).toEqual([]);
    expect(await enrolledNames(cycle.id)).toHaveLength(4);

    // The next day Hana (milestone 03-11) joins; everyone else is already in.
    const next = await enrollDueParticipants(db, cycle.id, "2026-03-11");
    expect(next.enrolled.map((e) => e.displayName)).toEqual(["Hana"]);
    expect(await enrolledNames(cycle.id)).toHaveLength(5);
  });

  it("does not bring back someone who was removed", async () => {
    const cycle = await launched();
    await enrollDueParticipants(db, cycle.id, AS_OF);
    await removeParticipant(db, cycle.id, people.dana);
    const again = await enrollDueParticipants(db, cycle.id, AS_OF);
    expect(again.enrolled).toEqual([]);
    const detail = await getCycle(db, cycle.id);
    expect(detail!.stats).toMatchObject({ active: 3, removed: 1 });
  });

  it("only considers people matching the cycle's participant filter", async () => {
    const sales = await hire("Sol", "2026-02-01", { department: "Ventas" });
    const cycle = await launched({
      participantFilter: { kind: "filter", departments: ["Ventas"] },
    });
    const result = await enrollDueParticipants(db, cycle.id, AS_OF);
    expect(result.enrolled.map((e) => e.personId)).toEqual([sales]);
  });

  it("uses the milestone and window of the schedule", async () => {
    const cycle = await launched({
      hireDateSchedule: { milestoneDays: 365, windowWeeks: 1 },
    });
    // Hired Feb 29 2024: milestone is 2025-02-28 (365 days later).
    const leap = await hire("Lea", "2024-02-29");
    const result = await enrollDueParticipants(db, cycle.id, "2025-03-04");
    expect(result.enrolled.map((e) => e.personId)).toEqual([leap]);
    expect(result.enrolled[0]).toMatchObject({
      milestoneDate: "2025-02-28",
      dueDates: { self: "2025-03-07", manager: "2025-03-07" },
    });
  });

  it("uses the latest employment of a rehired person", async () => {
    const rehired = await hire("Rita", "2024-01-10", {
      terminatedOn: "2024-06-01",
    });
    await db.insert(employment).values({
      personId: rehired,
      hireDate: "2026-02-02",
      status: "Active",
      sourceSystem: "native",
      sourceId: "Rita-2",
    });
    await db.insert(employeeJobHistory).values({
      personId: rehired,
      validFrom: "2026-02-02",
      department: "Ingeniería",
      sourceSystem: "native",
      sourceId: "Rita-job-2",
    });
    const cycle = await launched();
    const result = await enrollDueParticipants(db, cycle.id, AS_OF);
    expect(result.enrolled.map((e) => e.displayName)).toContain("Rita");
  });

  it("assigns template groups to the people it enrolls", async () => {
    const sales = await hire("Sol", "2026-02-01", { department: "Ventas" });
    const cycle = await hireDateCycle();
    await setCycleGroups(db, cycle.id, [
      {
        name: "Ventas",
        templateId: salesTemplate,
        filter: { kind: "filter", departments: ["Ventas"] },
      },
    ]);
    await launchCycle(db, cycle.id, null);
    await enrollDueParticipants(db, cycle.id, AS_OF);
    expect(promptsOf(await participantQuestions(cycle.id, sales))).toContain(
      "Pregunta de Ventas",
    );
    expect(
      promptsOf(await participantQuestions(cycle.id, people.dana)),
    ).not.toContain("Pregunta de Ventas");
  });

  it("refuses fixed-date, draft and closed cycles", async () => {
    const fixed = await createCycle(db, input());
    await launchCycle(db, fixed.id, null);
    await expect(
      enrollDueParticipants(db, fixed.id, AS_OF),
    ).rejects.toMatchObject({ code: "not_hire_date" });

    const draft = await hireDateCycle();
    await expect(
      enrollDueParticipants(db, draft.id, AS_OF),
    ).rejects.toMatchObject({ code: "not_active" });

    const closed = await launched();
    for (const to of [
      "collecting",
      "manager_review",
      "calibration",
      "sharing",
      "closed",
    ] as const) {
      await transition(db, closed.id, to, null);
    }
    await expect(
      enrollDueParticipants(db, closed.id, AS_OF),
    ).rejects.toMatchObject({ code: "not_active" });
    await expect(
      enrollDueParticipants(db, "00000000-0000-4000-8000-000000000000", AS_OF),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("leaves out people who had already left on that date, even if their job row is still open", async () => {
    // The ingest lags: the job row of both is open, but only Zoe has left.
    await hire("Zoe", "2026-02-02", {
      terminatedOn: "2026-03-05",
      keepJobOpen: true,
    });
    await hire("Lu", "2026-02-03", {
      terminatedOn: "2026-03-20",
      keepJobOpen: true,
    });
    const cycle = await launched();
    const result = await enrollDueParticipants(db, cycle.id, AS_OF);
    const names = result.enrolled.map((e) => e.displayName);
    expect(names).not.toContain("Zoe");
    // Lu is still employed on the enrollment date.
    expect(names).toContain("Lu");
  });

  it("reports people due who have no job history yet instead of dropping them", async () => {
    const sin = await hire("Sin", "2026-02-01", { noJob: true });
    const cycle = await launched();

    const first = await enrollDueParticipants(db, cycle.id, AS_OF);
    expect(first.enrolled.map((e) => e.displayName)).not.toContain("Sin");
    expect(first.skipped).toEqual([
      {
        personId: sin,
        displayName: "Sin",
        hireDate: "2026-02-01",
        reason: "no_job_history",
      },
    ]);

    // Once the history arrives, the next run enrolls them.
    await db.insert(employeeJobHistory).values({
      personId: sin,
      validFrom: "2026-02-01",
      department: "Ingeniería",
      sourceSystem: "native",
      sourceId: "Sin-job",
    });
    const next = await enrollDueParticipants(db, cycle.id, "2026-03-11");
    expect(next.enrolled.map((e) => e.displayName)).toContain("Sin");
    expect(next.skipped).toEqual([]);
  });

  it("does not report people the cycle's filter leaves out", async () => {
    await hire("Sol", "2026-02-01", { department: "Ventas" });
    const cycle = await launched({
      participantFilter: { kind: "filter", departments: ["Ventas"] },
    });
    const result = await enrollDueParticipants(db, cycle.id, AS_OF);
    expect(result.enrolled.map((e) => e.displayName)).toEqual(["Sol"]);
    expect(result.skipped).toEqual([]);
  });

  it("can look further back than the window to catch up after an outage", async () => {
    // Milestone 2026-02-19: five days before the window [02-24, 03-10].
    const tarde = await hire("Tarde", "2026-01-20");
    const cycle = await launched();
    const without = await enrollDueParticipants(db, cycle.id, AS_OF);
    expect(without.enrolled.map((e) => e.personId)).not.toContain(tarde);
    const short = await enrollDueParticipants(db, cycle.id, AS_OF, {
      lookbackDays: 4,
    });
    expect(short.enrolled.map((e) => e.personId)).not.toContain(tarde);

    const caught = await enrollDueParticipants(db, cycle.id, AS_OF, {
      lookbackDays: 5,
    });
    expect(caught.enrolled).toEqual([
      expect.objectContaining({
        personId: tarde,
        milestoneDate: "2026-02-19",
        // The deadline is still milestone + window.
        dueDates: { self: "2026-03-05", manager: "2026-03-05" },
      }),
    ]);
    for (const lookbackDays of [-1, 1.5, 366]) {
      await expect(
        enrollDueParticipants(db, cycle.id, AS_OF, { lookbackDays }),
      ).rejects.toMatchObject({ code: "validation" });
    }
  });

  it("gives someone added by hand their own deadline too", async () => {
    const cycle = await launched();
    // Bruno: hired 2021-07-15, 30 days + 2 weeks = 2021-08-28.
    const row = await addParticipant(db, cycle.id, bruno, AS_OF);
    expect(row.dueDates).toEqual({ self: "2021-08-28", manager: "2021-08-28" });
    // Removing and adding back recomputes them.
    await removeParticipant(db, cycle.id, bruno);
    const again = await addParticipant(db, cycle.id, bruno, AS_OF);
    expect(again.dueDates).toEqual({
      self: "2021-08-28",
      manager: "2021-08-28",
    });

    // Fixed-date cycles keep using the cycle's due dates.
    const fixed = await createCycle(db, input());
    await launchCycle(db, fixed.id, null);
    await removeParticipant(db, fixed.id, bruno);
    expect(
      (await addParticipant(db, fixed.id, bruno, AS_OF)).dueDates,
    ).toBeNull();
  });

  it("snapshots the goals of the people it enrolls, as at launch", async () => {
    // The cycle's period is 2022-01-01..2022-06-30: a goal due inside it counts.
    await db.insert(goal).values({
      sourceSystem: "bamboo_api",
      sourceId: "g-dana",
      personId: people.dana,
      title: "Meta de Dana",
      status: "in_progress",
      percentComplete: 40,
      dueDate: "2022-03-01",
    });
    const cycle = await launched();
    await enrollDueParticipants(db, cycle.id, AS_OF);
    const [participant] = (await getCycle(db, cycle.id))!.participants.filter(
      (p) => p.revieweePersonId === people.dana,
    );
    const rows = await db
      .select()
      .from(participantGoalSnapshot)
      .where(eq(participantGoalSnapshot.participantId, participant.id));
    expect(rows.map((r) => [r.title, r.percentComplete])).toEqual([
      ["Meta de Dana", 40],
    ]);
  });

  it("gives the people it enrolls their self request and own deadline", async () => {
    const cycle = await launched();
    await transition(db, cycle.id, "collecting", null);
    await enrollDueParticipants(db, cycle.id, AS_OF);

    const requestId = await findMySelfRequestId(db, as(people.dana), cycle.id);
    expect(requestId).toBeTruthy();
    const review = await getSelfReview(db, as(people.dana), requestId!);
    // Hired 2026-01-31: milestone 2026-03-02, two weeks to complete it.
    expect(review!.cycle.dueDate).toBe("2026-03-16");
    const tasks = await listMyTasks(db, as(people.dana));
    expect(tasks.selfAssessments.map((t) => t.dueDate)).toEqual(["2026-03-16"]);
    // Whoever is not due yet has no request.
    expect(await findMySelfRequestId(db, as(people.hana), cycle.id)).toBeNull();
  });

  it("enrolls whoever is due today when the cycle launches", async () => {
    const today = todayLocal();
    const due = await hire("Hoy", addDays(today, -30));
    await hire("Mañana", addDays(today, -29));
    const cycle = await launched();
    const detail = await getCycle(db, cycle.id);
    expect(detail!.participants.map((p) => p.revieweePersonId)).toEqual([due]);
    expect(detail!.participants[0]).toMatchObject({
      snapshotAsOf: today,
      dueDates: {
        self: addDays(today, 14),
        manager: addDays(today, 14),
      },
    });
    expect(detail!.status).toBe("nominations");
  });

  it("launches with nobody due yet", async () => {
    const cycle = await launched();
    const detail = await getCycle(db, cycle.id);
    expect(detail!.participants).toEqual([]);
    expect(detail!.status).toBe("nominations");
    expect(detail!.questionCount).toBeGreaterThan(0);
  });

  it("enrolls into every active hire-date cycle", async () => {
    const a = await launched({ name: "A" });
    const b = await launched({
      name: "B",
      hireDateSchedule: { milestoneDays: 60, windowWeeks: 4 },
    });
    const draft = await hireDateCycle({ name: "Borrador" });
    const fixed = await createCycle(db, input({ name: "Fija" }));
    await launchCycle(db, fixed.id, null);

    const results = await enrollAllDueParticipants(db, AS_OF);

    expect(results.map((r) => r.cycleId).sort()).toEqual([a.id, b.id].sort());
    expect(await enrolledNames(a.id)).toEqual(["Dana", "Eli", "Ines", "Joel"]);
    // 60 days + 4 weeks: hired between 2025-12-12 and 2026-01-09: nobody.
    expect(await enrolledNames(b.id)).toEqual([]);
    expect(await enrolledNames(draft.id)).toEqual([]);
    expect(await enrolledNames(fixed.id)).toHaveLength(3);
  });

  it("reports a cycle that fails without stopping the others", async () => {
    const good = await launched({ name: "Buena" });
    const broken = await launched({ name: "Rota" });
    await db
      .update(reviewCycle)
      .set({ hireDateSchedule: null })
      .where(eq(reviewCycle.id, broken.id));
    const results = await enrollAllDueParticipants(db, AS_OF);
    const byCycle = new Map(results.map((r) => [r.cycleId, r]));
    expect(byCycle.get(broken.id)?.error).toBe("not_hire_date");
    expect(byCycle.get(good.id)?.error).toBeUndefined();
    expect(await enrolledNames(good.id)).toHaveLength(4);
  });
});

describe("enrollCli", () => {
  async function run(argv: string[]) {
    const lines: string[] = [];
    const code = await enrollCli(argv, { db, out: (l) => lines.push(l) });
    return { code, text: lines.join("\n") };
  }

  beforeEach(async () => {
    await hire("Dana", "2026-01-31");
    await hire("Hana", "2026-02-09");
  });

  it("enrolls one cycle as of a date and lists who joined", async () => {
    const cycle = await launched();
    const first = await run(["--cycle", cycle.id, "--as-of", AS_OF]);
    expect(first.code).toBe(0);
    expect(first.text).toContain(`${cycle.id} as of ${AS_OF}: 1 enrolled`);
    expect(first.text).toContain("Dana");
    expect(first.text).toContain("2026-03-16");
    expect(first.text).not.toContain("Hana");
  });

  it("is idempotent: the second run enrolls no one", async () => {
    const cycle = await launched();
    await run(["--cycle", cycle.id, "--as-of", AS_OF]);
    const again = await run(["--cycle", cycle.id, "--as-of", AS_OF]);
    expect(again.code).toBe(0);
    expect(again.text).toContain("0 enrolled");
    expect(await enrolledNames(cycle.id)).toEqual(["Dana"]);
  });

  it("runs on every active hire-date cycle without --cycle", async () => {
    const a = await launched({ name: "A" });
    const b = await launched({ name: "B" });
    const { code, text } = await run(["--as-of", AS_OF]);
    expect(code).toBe(0);
    expect(text).toContain(a.id);
    expect(text).toContain(b.id);
    expect(await enrolledNames(a.id)).toEqual(["Dana"]);
    expect(await enrolledNames(b.id)).toEqual(["Dana"]);
  });

  it("lists who was skipped for lack of job history and takes --lookback-days", async () => {
    await hire("Sin", "2026-02-01", { noJob: true });
    await hire("Tarde", "2026-01-20");
    const cycle = await launched();
    const first = await run(["--cycle", cycle.id, "--as-of", AS_OF]);
    expect(first.code).toBe(0);
    expect(first.text).toMatch(/skipped Sin.*no_job_history/);
    expect(first.text).not.toContain("Tarde");

    const later = await run([
      "--cycle",
      cycle.id,
      "--as-of",
      AS_OF,
      "--lookback-days",
      "5",
    ]);
    expect(later.text).toContain("Tarde");
  });

  it("exits 1 when a cycle cannot be enrolled", async () => {
    const draft = await hireDateCycle();
    const result = await run(["--cycle", draft.id, "--as-of", AS_OF]);
    expect(result.code).toBe(1);
    expect(result.text).toContain("not_active");
  });

  it("exits 2 on wrong arguments and prints the usage", async () => {
    const result = await run(["--as-of", "2026-13-01"]);
    expect(result.code).toBe(2);
    expect(result.text).toContain("--as-of");
    expect(result.text).toContain("Usage");
  });
});

describe("recentHires", () => {
  it("lists the most recent hires among active employees", async () => {
    await hire("Vieja", "2020-01-01");
    await hire("Nueva", "2026-02-01");
    await hire("Intermedia", "2025-06-01");
    await hire("Baja", "2026-03-01", { terminatedOn: "2026-03-05" });
    const hires = await recentHires(db, 2);
    expect(hires.map((h) => [h.displayName, h.hireDate])).toEqual([
      ["Nueva", "2026-02-01"],
      ["Intermedia", "2025-06-01"],
    ]);
  });

  it("is empty without employments", async () => {
    await db.execute(sql`TRUNCATE employment, person CASCADE`);
    expect(await recentHires(db)).toEqual([]);
  });
});
