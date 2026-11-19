import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { MockProvider } from "./mock-provider";
import {
  listComments,
  qualitativeUniverse,
  sentimentByGroup,
  sentimentTotals,
  sentimentVsIndicators,
  topThemes,
} from "./queries";
import { runAnalysis } from "./service";
import {
  insertAnswer,
  insertCycle,
  insertParticipant,
  insertPerson,
  insertQuestion,
  resetQualitative,
} from "./test-support";

/**
 * Privacy of the qualitative queries (#129): the minimum counts distinct
 * people, direction cannot narrow below it, a manager never reads a self
 * review the double blind still keeps from them, and the retention labels
 * come from the question's choices by value.
 */
const hr: ActorContext = { personId: null, role: "hr" };
const direction: ActorContext = { personId: null, role: "direction" };
const MIN = 3;
let boss: string;
let lonely: string;
let blind: string;
let open: string;
const cycles: string[] = [];

const RETENTION_CHOICES = [
  { value: "A", label: { es: "Haría todo para retenerlo", en: "Do everything" } },
  { value: "B", label: { es: "Intentaría convencerlo", en: "Convince" } },
  { value: "C", label: { es: "Tendría que pensarlo", en: "Think" } },
  { value: "D", label: { es: "Le desearía lo mejor", en: "Wish well" } },
  { value: "E", label: { es: "Me sentiría aliviado", en: "Relieved" } },
];

beforeAll(async () => {
  await resetQualitative();
  boss = await insertPerson("Jefa Uno");
  lonely = await insertPerson("Única Persona");
  blind = await insertPerson("Bruno Ciego");
  open = await insertPerson("Olga Abierta");
  const team = [
    await insertPerson("Ana Equipo"),
    await insertPerson("Beto Equipo"),
    await insertPerson("Ceci Equipo"),
  ];
  // One person alone in an area, in four cycles: four participations.
  for (const [i, end] of [
    "2023-06-30",
    "2023-12-31",
    "2024-06-30",
    "2024-12-31",
  ].entries()) {
    const cycle = await insertCycle(`Ciclo ${i}`, end);
    cycles.push(cycle);
    const well = await insertQuestion(cycle, "What do I do well?", {
      dimension: "strengths",
    });
    const retention = await insertQuestion(cycle, "Retention", {
      kind: "single_choice",
      role: "retention",
      choices: RETENTION_CHOICES,
    });
    const p = await insertParticipant(cycle, lonely, boss, "Área chica");
    await insertAnswer(cycle, p, lonely, "self", [
      { questionId: well, text: "Excelente comunicación con el equipo." },
    ]);
    await insertAnswer(cycle, p, boss, "manager", [
      {
        questionId: retention,
        // The report's own text, with a name in it: never a label.
        option: "I would try to convince them to stay. Única Persona would be difficult to replace",
        value: 4,
      },
    ]);
    for (const person of team) {
      const t = await insertParticipant(cycle, person, boss, "Área grande");
      await insertAnswer(cycle, t, person, "self", [
        { questionId: well, text: "Gran trabajo en equipo y comunicación." },
      ]);
    }
  }
  // The last cycle: one self review whose manager review is still open
  // (double blind keeps it from the manager), one whose manager review is in.
  const last = cycles[cycles.length - 1];
  const [well] = await db.execute<{ id: string }>(sql`
    select id from question_revision where cycle_id = ${last}::uuid and dimension = 'strengths'`);
  const pb = await insertParticipant(last, blind, boss, "Área grande");
  await insertAnswer(last, pb, blind, "self", [
    { questionId: well.id, text: "Excelente documentación de los procesos." },
  ]);
  await db.execute(sql`
    insert into review_request (cycle_id, participant_id, reviewer_person_id, relationship, status)
    values (${last}::uuid, ${pb}::uuid, ${boss}::uuid, 'manager', 'draft')`);
  const po = await insertParticipant(last, open, boss, "Área grande");
  await insertAnswer(last, po, open, "self", [
    { questionId: well.id, text: "Excelente planificación del sprint." },
  ]);
  await insertAnswer(last, po, boss, "manager", []);
  await runAnalysis(db, { provider: new MockProvider() });
}, 60_000);
afterAll(closeDb);

describe("minimum group size over distinct people", () => {
  it("hides an area of one person with several participations from direction", async () => {
    const f = { minGroupSize: MIN };
    const groups = await sentimentByGroup(db, direction, f, "department");
    expect(groups.map((g) => g.key)).toEqual(["Área grande"]);
    // "participants" are people, not participations.
    expect(groups[0].participants).toBe(5);
  });

  it("does not let direction filter down to a universe under the minimum", async () => {
    const f = { minGroupSize: MIN, department: "Área chica" };
    expect(await sentimentTotals(db, direction, f)).toBeNull();
    expect(await topThemes(db, direction, f)).toEqual([]);
    expect(await qualitativeUniverse(db, direction, f)).toEqual({
      people: null,
      masked: true,
      minGroupSize: MIN,
    });
    // People still read it.
    expect((await sentimentTotals(db, hr, f))?.total).toBe(4);
    expect((await qualitativeUniverse(db, hr, f)).people).toBe(1);
  });
});

describe("double blind for a manager", () => {
  it("keeps a self review from the manager until their own review is submitted", async () => {
    const manager: ActorContext = { personId: boss, role: "manager" };
    const cycleId = cycles[cycles.length - 1];
    const texts = (await listComments(db, manager, { cycleId })).map(
      (c) => c.text,
    );
    expect(texts).toContain("Excelente planificación del sprint.");
    expect(texts).not.toContain("Excelente documentación de los procesos.");
    const totals = await sentimentTotals(db, manager, { cycleId });
    expect(totals?.total).toBe(texts.length);
    // People read both.
    const all = (await listComments(db, hr, { cycleId })).map((c) => c.text);
    expect(all).toContain("Excelente documentación de los procesos.");
  });
});

describe("retention categories", () => {
  it("are labelled by value with the question's choices, never the raw option text", async () => {
    const rows = await sentimentVsIndicators(db, hr, {});
    const four = rows.find((r) => r.role === "retention" && r.value === 4);
    expect(four?.label?.es).toBe("Intentaría convencerlo");
    expect(JSON.stringify(rows)).not.toContain("Única Persona");
  });
});
