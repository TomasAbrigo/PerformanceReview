import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { goal, participantGoalSnapshot, questionRevision } from "@/db/schema";
import type { ActorContext } from "@/modules/actor/types";
import {
  employmentIdOf,
  insertJob,
  insertParticipant,
  insertPerson,
  resetAll,
} from "@/modules/analytics/test-support";
import {
  insertAnswers,
  insertQuestion,
  insertRequest,
  insertReviewCycle,
} from "@/modules/api/review-test-support";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";
import { ReviewError } from "@/modules/review-core/review-errors";
import {
  type AssessmentListPage,
  assessmentFilterOptions,
  getAssessment,
  listAssessmentCycles,
  listAssessmentParticipants,
} from "./queries";

/**
 * Ana (CEO) <- Bruno <- Dora and Eli; Zoe reports to Ana.
 *
 * "Ciclo A" (closed, no double blind), questions: Fortalezas (text, both
 * sides), Valoración (rating, self), Retención (closed Likert, manager, hidden
 * from the employee), Comentario (text, manager), Pregunta propia (text,
 * custom, both).
 *   Dora  self submitted, manager submitted AND shared
 *   Eli   self submitted, manager draft
 *   Zoe   self submitted, manager submitted, NOT shared
 *   Bruno self submitted, no manager request
 * "Ciclo B" (closed, double blind): Dora self submitted, manager (Bruno) draft.
 */
let w: {
  ana: string;
  bruno: string;
  dora: string;
  eli: string;
  zoe: string;
  cycleA: string;
  cycleB: string;
  draftCycle: string;
  pDora: string;
  pEli: string;
  pZoe: string;
  pBruno: string;
  pDoraB: string;
  retention: string;
  goalMigrar: string;
};

const hr: ActorContext = { personId: null, role: "hr" };
const as = (role: ActorContext["role"], personId: string): ActorContext => ({
  role,
  personId,
});

async function person(
  name: string,
  bambooId: string,
  manager: string | undefined,
  dept: string,
) {
  const id = await insertPerson({ displayName: name, bambooId });
  await insertJob({
    personId: id,
    validFrom: "2020-01-01",
    managerPersonId: manager ?? null,
    employmentId: await employmentIdOf(id),
    department: dept,
  });
  return id;
}

beforeAll(async () => {
  await resetAll();
  const ana = await person("Ana Prieto", "1", undefined, "Dirección");
  const bruno = await person("Bruno Gil", "2", ana, "Tecnología");
  const dora = await person("Dora Díaz", "3", bruno, "Producto");
  const eli = await person("Eli Roca", "4", bruno, "Tecnología");
  const zoe = await person("Zoe Luna", "5", ana, "Tecnología");
  await setOrgAttributes(dora, { dm: "Dana DM" });
  await setOrgAttributes(eli, { dm: "Otro DM" });

  const cycleA = await insertReviewCycle({
    name: "Ciclo A",
    status: "closed",
    components: { doubleBlind: false },
  });
  const cycleB = await insertReviewCycle({
    name: "Ciclo B",
    status: "closed",
    components: { doubleBlind: true },
  });
  const draftCycle = await insertReviewCycle({
    name: "Borrador",
    status: "draft",
  });

  const q1 = await insertQuestion({
    cycleId: cycleA,
    sort: 0,
    kind: "text",
    appliesTo: ["self", "manager"],
    prompt: { es: "Fortalezas", en: "Strengths" },
  });
  const q2 = await insertQuestion({
    cycleId: cycleA,
    sort: 1,
    kind: "rating",
    appliesTo: ["self"],
    prompt: { es: "Valoración", en: "Rating" },
  });
  const retention = await insertQuestion({
    cycleId: cycleA,
    sort: 2,
    kind: "single_choice",
    role: "retention",
    appliesTo: ["manager"],
    visibleToReviewee: false,
    prompt: { es: "Retención", en: "Retention" },
    choices: [
      { value: "A", label: { es: "Me convencería", en: "I would convince" } },
      { value: "B", label: { es: "Lo intentaría", en: "I would try" } },
    ],
  });
  const q4 = await insertQuestion({
    cycleId: cycleA,
    sort: 3,
    kind: "text",
    appliesTo: ["manager"],
    prompt: { es: "Comentario", en: "Comment" },
  });
  const q5 = await insertQuestion({
    cycleId: cycleA,
    sort: 4,
    kind: "text",
    appliesTo: ["self", "manager"],
    prompt: { es: "Pregunta propia", en: "Own question" },
  });
  await db
    .update(questionRevision)
    .set({ dimension: "custom_propia" })
    .where(eq(questionRevision.id, q5));
  const qB = await insertQuestion({
    cycleId: cycleB,
    sort: 0,
    kind: "text",
    appliesTo: ["self", "manager"],
    prompt: { es: "Fortalezas B", en: "Strengths B" },
  });

  const pDora = await insertParticipant({
    cycleId: cycleA,
    personId: dora,
    snapManagerPersonId: bruno,
    snapDepartment: "Producto",
  });
  const pEli = await insertParticipant({
    cycleId: cycleA,
    personId: eli,
    snapManagerPersonId: bruno,
    snapDepartment: "Tecnología",
  });
  const pZoe = await insertParticipant({
    cycleId: cycleA,
    personId: zoe,
    snapManagerPersonId: ana,
    snapDepartment: "Tecnología",
  });
  const pBruno = await insertParticipant({
    cycleId: cycleA,
    personId: bruno,
    snapManagerPersonId: ana,
    snapDepartment: "Tecnología",
  });
  const pDoraB = await insertParticipant({
    cycleId: cycleB,
    personId: dora,
    snapManagerPersonId: bruno,
    snapDepartment: "Producto",
  });

  const shared = new Date("2026-07-01T12:00:00Z");
  const selfDora = await insertRequest({
    cycleId: cycleA,
    participantId: pDora,
    reviewerPersonId: dora,
    relationship: "self",
  });
  const mgrDora = await insertRequest({
    cycleId: cycleA,
    participantId: pDora,
    reviewerPersonId: bruno,
    relationship: "manager",
    sharedAt: shared,
  });
  const selfEli = await insertRequest({
    cycleId: cycleA,
    participantId: pEli,
    reviewerPersonId: eli,
    relationship: "self",
  });
  await insertRequest({
    cycleId: cycleA,
    participantId: pEli,
    reviewerPersonId: bruno,
    relationship: "manager",
    status: "draft",
  });
  await insertRequest({
    cycleId: cycleA,
    participantId: pZoe,
    reviewerPersonId: zoe,
    relationship: "self",
  });
  const mgrZoe = await insertRequest({
    cycleId: cycleA,
    participantId: pZoe,
    reviewerPersonId: ana,
    relationship: "manager",
  });
  await insertRequest({
    cycleId: cycleA,
    participantId: pBruno,
    reviewerPersonId: bruno,
    relationship: "self",
  });
  const selfDoraB = await insertRequest({
    cycleId: cycleB,
    participantId: pDoraB,
    reviewerPersonId: dora,
    relationship: "self",
  });
  await insertRequest({
    cycleId: cycleB,
    participantId: pDoraB,
    reviewerPersonId: bruno,
    relationship: "manager",
    status: "draft",
  });

  await insertAnswers([
    { requestId: selfDora, questionRevisionId: q1, textValue: "Soy ordenada" },
    {
      requestId: selfDora,
      questionRevisionId: q2,
      optionValue: 3,
      optionLabel: "Alto",
      normalized: 2 / 3,
    },
    {
      requestId: selfDora,
      questionRevisionId: q5,
      textValue: "Mi respuesta propia",
    },
    { requestId: mgrDora, questionRevisionId: q1, textValue: "Muy ordenada" },
    {
      requestId: mgrDora,
      questionRevisionId: retention,
      optionValue: 5,
      optionLabel: "A",
      normalized: 1,
    },
    { requestId: mgrDora, questionRevisionId: q4, textValue: "Sigue así" },
    { requestId: selfEli, questionRevisionId: q1, textValue: "Soy rápido" },
    { requestId: mgrZoe, questionRevisionId: q1, textValue: "Reservada" },
    { requestId: selfDoraB, questionRevisionId: qB, textValue: "Auto B" },
  ]);

  // Goals: two of Dora's, snapshotted in cycle A.
  const [migrar] = await db
    .insert(goal)
    .values({
      personId: dora,
      title: "Migrar la API",
      sourceSystem: "native",
      percentComplete: 40,
      dueDate: "2026-12-31",
    })
    .returning({ id: goal.id });
  await db.insert(participantGoalSnapshot).values([
    {
      participantId: pDora,
      goalId: migrar.id,
      goalSourceKey: `native:${migrar.id}`,
      title: "Migrar la API",
      status: "in_progress",
      percentComplete: 10,
      dueDate: "2026-12-31",
    },
    {
      participantId: pDora,
      goalId: null,
      goalSourceKey: "native:gone",
      title: "Meta borrada",
      status: "closed",
      percentComplete: 0,
      noLongerApplicable: true,
    },
  ]);

  w = {
    ana,
    bruno,
    dora,
    eli,
    zoe,
    cycleA,
    cycleB,
    draftCycle,
    pDora,
    pEli,
    pZoe,
    pBruno,
    pDoraB,
    retention,
    goalMigrar: migrar.id,
  };
});
afterAll(async () => {
  await resetAll();
  await closeDb();
});

const names = (page: AssessmentListPage) =>
  page.items.map((r) => r.person.name);
const rowOf = (page: AssessmentListPage, name: string) =>
  page.items.find((r) => r.person.name === name)!;

describe("listAssessmentCycles", () => {
  it("lists the launched cycles, latest first, never a draft", async () => {
    const cycles = await listAssessmentCycles(db, hr);
    expect(cycles.map((c) => c.name).sort()).toEqual(["Ciclo A", "Ciclo B"]);
    expect(cycles.find((c) => c.name === "Ciclo A")?.participantCount).toBe(4);
  });

  it("gives an employee only the cycles they take part in", async () => {
    const eli = await listAssessmentCycles(db, as("employee", w.eli));
    expect(eli.map((c) => c.name)).toEqual(["Ciclo A"]);
    const dora = await listAssessmentCycles(db, as("employee", w.dora));
    expect(dora.map((c) => c.name).sort()).toEqual(["Ciclo A", "Ciclo B"]);
    expect(dora.every((c) => c.participantCount === 1)).toBe(true);
  });
});

describe("listAssessmentParticipants: who is listed", () => {
  it("gives People every participant, with each side's progress", async () => {
    const page = await listAssessmentParticipants(db, hr, w.cycleA);
    expect(names(page)).toEqual([
      "Bruno Gil",
      "Dora Díaz",
      "Eli Roca",
      "Zoe Luna",
    ]);
    expect(page.counts).toEqual({ complete: 2, partial: 2, pending: 0 });
    expect(rowOf(page, "Dora Díaz")).toMatchObject({
      progress: "complete",
      self: { state: "submitted" },
      managerReview: { state: "submitted" },
      manager: { name: "Bruno Gil" },
      department: "Producto",
    });
    expect(rowOf(page, "Eli Roca")).toMatchObject({
      progress: "partial",
      managerReview: { state: "draft" },
    });
    expect(rowOf(page, "Bruno Gil").managerReview.state).toBe("none");
  });

  it("gives a manager their snapshot reports and themself, not the rest", async () => {
    const page = await listAssessmentParticipants(
      db,
      as("manager", w.bruno),
      w.cycleA,
    );
    expect(names(page)).toEqual(["Bruno Gil", "Dora Díaz", "Eli Roca"]);
    // As the snapshot manager they read Dora's self review (no double blind).
    expect(rowOf(page, "Dora Díaz").self.state).toBe("submitted");
  });

  it("gives an employee only themself", async () => {
    const page = await listAssessmentParticipants(
      db,
      as("employee", w.dora),
      w.cycleA,
    );
    expect(names(page)).toEqual(["Dora Díaz"]);
  });

  it("refuses direction and an actor without a person", async () => {
    for (const actor of [
      { personId: null, role: "direction" },
      { personId: null, role: "manager" },
      { personId: null, role: "employee" },
    ] as ActorContext[]) {
      await expect(
        listAssessmentParticipants(db, actor, w.cycleA),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("is not_found for an unknown, malformed or draft cycle", async () => {
    for (const id of [
      w.draftCycle,
      "nope",
      "00000000-0000-4000-8000-000000000000",
    ]) {
      await expect(
        listAssessmentParticipants(db, hr, id),
      ).rejects.toMatchObject({ code: "not_found" });
    }
  });
});

describe("listAssessmentParticipants: canRead decides what each state says", () => {
  it("shows a manager review as locked to its reviewee until it is shared", async () => {
    const eli = await listAssessmentParticipants(
      db,
      as("employee", w.eli),
      w.cycleA,
    );
    expect(rowOf(eli, "Eli Roca")).toMatchObject({
      self: { state: "submitted" },
      managerReview: { state: "locked" },
      progress: "partial",
    });
    const zoe = await listAssessmentParticipants(
      db,
      as("employee", w.zoe),
      w.cycleA,
    );
    expect(rowOf(zoe, "Zoe Luna").managerReview.state).toBe("locked");
    // Dora's was shared with her.
    const dora = await listAssessmentParticipants(
      db,
      as("employee", w.dora),
      w.cycleA,
    );
    expect(rowOf(dora, "Dora Díaz").managerReview.state).toBe("submitted");
  });

  it("locks the self review for the manager under double blind until theirs is submitted", async () => {
    const bruno = await listAssessmentParticipants(
      db,
      as("manager", w.bruno),
      w.cycleB,
    );
    expect(rowOf(bruno, "Dora Díaz")).toMatchObject({
      self: { state: "locked" },
      managerReview: { state: "draft" },
    });
    expect(
      (await listAssessmentParticipants(db, hr, w.cycleB)).items[0].self.state,
    ).toBe("submitted");
  });
});

describe("listAssessmentParticipants: filters", () => {
  it("filters by progress, the counts staying whole", async () => {
    const page = await listAssessmentParticipants(db, hr, w.cycleA, {
      progress: "complete",
    });
    expect(names(page)).toEqual(["Dora Díaz", "Zoe Luna"]);
    expect(page.total).toBe(2);
    expect(page.counts.partial).toBe(2);
  });

  it("searches by name, as typed, and filters by area and org attributes", async () => {
    expect(
      names(await listAssessmentParticipants(db, hr, w.cycleA, { q: "dora" })),
    ).toEqual(["Dora Díaz"]);
    expect(
      (await listAssessmentParticipants(db, hr, w.cycleA, { q: "%" })).total,
    ).toBe(0);
    expect(
      names(
        await listAssessmentParticipants(db, hr, w.cycleA, {
          department: "Producto",
        }),
      ),
    ).toEqual(["Dora Díaz"]);
    expect(
      names(
        await listAssessmentParticipants(db, hr, w.cycleA, { dm: "Otro DM" }),
      ),
    ).toEqual(["Eli Roca"]);
  });

  it("pages the list, and a page past the last one is the last one", async () => {
    const page2 = await listAssessmentParticipants(db, hr, w.cycleA, {
      page: 2,
    });
    expect(page2.page).toBe(1);
    expect(page2.total).toBe(4);
    expect(names(page2)).toHaveLength(4);
    const wild = await listAssessmentParticipants(db, hr, w.cycleA, {
      page: 10 ** 12,
    });
    expect(wild.page).toBe(1);
    expect(wild.items).toHaveLength(4);
  });

  it("pages a long cycle in the database: full pages, the counts whole, an out-of-range page clamped", async () => {
    const cycleId = await insertReviewCycle({
      name: "Ciclo largo",
      status: "closed",
    });
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) {
      const personId = await insertPerson({
        displayName: `Persona ${String(i).padStart(2, "0")}`,
        bambooId: `9${i}`,
      });
      ids.push(
        await insertParticipant({
          cycleId,
          personId,
          snapManagerPersonId: w.ana,
        }),
      );
    }
    // The first five have submitted their self-assessment only.
    for (const [i, participantId] of ids.slice(0, 5).entries()) {
      await insertRequest({
        cycleId,
        participantId,
        reviewerPersonId: null,
        relationship: "self",
      });
      expect(i).toBeLessThan(5);
    }
    const first = await listAssessmentParticipants(db, hr, cycleId);
    expect(first.items).toHaveLength(25);
    expect(first.total).toBe(30);
    expect(first.counts).toEqual({ complete: 0, partial: 5, pending: 25 });
    expect(first.items[0].person.name).toBe("Persona 00");
    const second = await listAssessmentParticipants(db, hr, cycleId, {
      page: 2,
    });
    expect(second.items.map((r) => r.person.name)).toEqual([
      "Persona 25",
      "Persona 26",
      "Persona 27",
      "Persona 28",
      "Persona 29",
    ]);
    const clamped = await listAssessmentParticipants(db, hr, cycleId, {
      page: 7,
    });
    expect(clamped.page).toBe(2);
    expect(clamped.items).toHaveLength(5);
    const partial = await listAssessmentParticipants(db, hr, cycleId, {
      progress: "partial",
    });
    expect(partial.total).toBe(5);
    expect(partial.items).toHaveLength(5);
    expect(
      partial.items.every(
        (r) => r.self.state === "none" || r.self.state === "submitted",
      ),
    ).toBe(true);
  });

  it("offers the area and org values of the participants in scope", async () => {
    const all = await assessmentFilterOptions(db, hr, w.cycleA);
    expect(all.departments).toEqual(["Producto", "Tecnología"]);
    expect(all.org.dms).toEqual(["Dana DM", "Otro DM"]);
    const eli = await assessmentFilterOptions(
      db,
      as("employee", w.eli),
      w.cycleA,
    );
    expect(eli.departments).toEqual(["Tecnología"]);
    expect(eli.org.dms).toEqual(["Otro DM"]);
  });
});

const prompts = (side: {
  sections: { questions: { prompt: { es: string } }[] }[];
}) => side.sections.flatMap((s) => s.questions.map((q) => q.prompt.es));
const sideOf = (
  d: Awaited<ReturnType<typeof getAssessment>>,
  r: "self" | "manager",
) => d.sides.find((s) => s.relationship === r)!;

describe("getAssessment", () => {
  it("gives People both forms with every question and answer", async () => {
    const d = await getAssessment(db, hr, w.cycleA, w.pDora);
    expect(d.participant).toMatchObject({
      person: { name: "Dora Díaz" },
      manager: { name: "Bruno Gil" },
      department: "Producto",
      removed: false,
    });
    expect(d.cycle.name).toBe("Ciclo A");
    const self = sideOf(d, "self");
    expect(self).toMatchObject({
      state: "submitted",
      author: { name: "Dora Díaz" },
    });
    expect(prompts(self)).toEqual([
      "Fortalezas",
      "Valoración",
      "Pregunta propia",
    ]);
    const mgr = sideOf(d, "manager");
    expect(mgr).toMatchObject({
      state: "submitted",
      author: { name: "Bruno Gil" },
    });
    expect(prompts(mgr)).toEqual([
      "Fortalezas",
      "Retención",
      "Comentario",
      "Pregunta propia",
    ]);
    const retention = mgr.sections[0].questions.find(
      (q) => q.prompt.es === "Retención",
    )!;
    expect(retention.answer).toMatchObject({
      optionValue: 5,
      optionLabel: "A",
    });
    expect(retention.role).toBe("retention");
    expect(
      mgr.sections[0].questions.find((q) => q.prompt.es === "Pregunta propia")
        ?.custom,
    ).toBe(true);
    // Unanswered questions are listed too.
    expect(
      mgr.sections[0].questions.find((q) => q.prompt.es === "Pregunta propia")
        ?.answer,
    ).toBeNull();
  });

  it("gives the goals of the period, with the link only to goals the actor may open", async () => {
    const d = await getAssessment(db, hr, w.cycleA, w.pDora);
    expect(
      d.goals.map((g) => [g.title, g.openable, g.noLongerApplicable]),
    ).toEqual([
      ["Migrar la API", true, false],
      ["Meta borrada", false, true],
    ]);
    expect(d.goalsAsOf).not.toBeNull();
    const asManager = await getAssessment(
      db,
      as("manager", w.bruno),
      w.cycleA,
      w.pDora,
    );
    expect(asManager.goals[0].openable).toBe(true);
  });

  it("never gives an employee the retention question, nor a manager review not shared yet", async () => {
    const dora = await getAssessment(
      db,
      as("employee", w.dora),
      w.cycleA,
      w.pDora,
    );
    expect(prompts(sideOf(dora, "self"))).toEqual([
      "Fortalezas",
      "Valoración",
      "Pregunta propia",
    ]);
    // Shared: she reads the manager review, minus the questions hidden from her.
    expect(prompts(sideOf(dora, "manager"))).toEqual([
      "Fortalezas",
      "Comentario",
      "Pregunta propia",
    ]);
    expect(JSON.stringify(dora)).not.toContain("Retención");

    const eli = await getAssessment(
      db,
      as("employee", w.eli),
      w.cycleA,
      w.pEli,
    );
    expect(sideOf(eli, "manager")).toMatchObject({
      state: "locked",
      sections: [],
      author: null,
    });
    const zoe = await getAssessment(
      db,
      as("employee", w.zoe),
      w.cycleA,
      w.pZoe,
    );
    expect(sideOf(zoe, "manager").state).toBe("locked");
    expect(JSON.stringify(zoe)).not.toContain("Reservada");
  });

  it("gives a manager their reports' forms in full, and only theirs", async () => {
    const d = await getAssessment(
      db,
      as("manager", w.bruno),
      w.cycleA,
      w.pDora,
    );
    expect(prompts(sideOf(d, "manager"))).toContain("Retención");
    // Their own: as the reviewee they read like an employee.
    const own = await getAssessment(
      db,
      as("manager", w.bruno),
      w.cycleA,
      w.pBruno,
    );
    expect(sideOf(own, "self").state).toBe("submitted");
    await expect(
      getAssessment(db, as("manager", w.bruno), w.cycleA, w.pZoe),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses an employee another person's assessment, and direction anyone's", async () => {
    await expect(
      getAssessment(db, as("employee", w.dora), w.cycleA, w.pEli),
    ).rejects.toBeInstanceOf(ReviewError);
    // Not even their own manager seen as an employee.
    await expect(
      getAssessment(db, as("employee", w.bruno), w.cycleA, w.pDora),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      getAssessment(
        db,
        { personId: null, role: "direction" },
        w.cycleA,
        w.pDora,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("is not_found for an unknown participant, cycle or a participant of another cycle", async () => {
    await expect(getAssessment(db, hr, w.cycleA, "nope")).rejects.toMatchObject(
      { code: "not_found" },
    );
    await expect(
      getAssessment(db, hr, w.cycleA, w.pDoraB),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      getAssessment(db, hr, w.draftCycle, w.pDora),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  describe("employee view", () => {
    it("shows People what the reviewee would read: no hidden question, no review not shared yet", async () => {
      const dora = await getAssessment(db, hr, w.cycleA, w.pDora, {
        employeeView: true,
      });
      expect(dora.employeeView).toBe(true);
      expect(prompts(sideOf(dora, "manager"))).toEqual([
        "Fortalezas",
        "Comentario",
        "Pregunta propia",
      ]);
      const zoe = await getAssessment(db, hr, w.cycleA, w.pZoe, {
        employeeView: true,
      });
      expect(sideOf(zoe, "manager")).toMatchObject({
        state: "locked",
        sections: [],
      });
      expect(sideOf(zoe, "self").state).toBe("submitted");
    });

    it("never gives a manager more than they could read, even as the employee would", async () => {
      // Double blind: Dora can read her own self review, her manager cannot yet.
      const d = await getAssessment(
        db,
        as("manager", w.bruno),
        w.cycleB,
        w.pDoraB,
        { employeeView: true },
      );
      expect(sideOf(d, "self")).toMatchObject({
        state: "locked",
        sections: [],
      });
    });
  });
});
