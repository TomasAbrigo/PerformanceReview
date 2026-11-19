import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { correctLabel } from "./correction";
import { MockProvider } from "./mock-provider";
import {
  agreementBySide,
  bestWorkOptions,
  managerFeedbackByGroup,
  readingProvenance,
  signalSummary,
  signalsVsIndicators,
  substanceByQuestion,
  themesBySide,
  toneByQuestion,
  valuedDistribution,
  yesNoAnswers,
  yesNoRates,
  yesNoTrend,
} from "./reading";
import { runAnalysis } from "./service";
import {
  insertAnswer,
  insertCycle,
  insertParticipant,
  insertPerson,
  insertQuestion,
  resetQualitative,
} from "./test-support";

const hr: ActorContext = { personId: null, role: "hr" };
const direction: ActorContext = { personId: null, role: "direction" };
let boss: string;
let ana: string;
let beto: string;
let c1: string;
let c2: string;

const VALUED = [
  { value: "A", label: { es: "Me siento muy valorado", en: "Highly valued" } },
  { value: "B", label: { es: "A veces me siento valorado", en: "Sometimes" } },
  { value: "C", label: { es: "No estoy seguro", en: "Not sure" } },
  { value: "D", label: { es: "No me siento valorado", en: "Not valued" } },
];
const BEST = [
  { value: "nothing", label: { es: "Nada, tengo todo", en: "Nothing" } },
  { value: "other", label: { es: "Otro", en: "Other" } },
];
const RETENTION = ["A", "B", "C", "D", "E"].map((value, i) => ({
  value,
  label: { es: `Retención ${5 - i}`, en: `Retention ${5 - i}` },
}));

async function questions(cycle: string) {
  return {
    well: await insertQuestion(cycle, "What do I do well?", {
      dimension: "strengths",
    }),
    improve: await insertQuestion(cycle, "How could I improve?", {
      dimension: "improvement",
    }),
    security: await insertQuestion(
      cycle,
      "Am I following all Information Security Policies?",
      { yesNo: true, dimension: "custom_security" },
    ),
    talk: await insertQuestion(
      cycle,
      "Do I speak with this employee frequently enough?",
      { yesNo: true, dimension: "custom_talk" },
    ),
    impact: await insertQuestion(
      cycle,
      "Do I contribute with initiatives related to Social impact? How?",
      { yesNo: true, dimension: "custom_impact" },
    ),
    valued: await insertQuestion(cycle, "Recognize my value", {
      kind: "single_choice",
      role: "valued",
      dimension: "valued",
      choices: VALUED,
    }),
    best: await insertQuestion(cycle, "Best work", {
      kind: "single_choice",
      dimension: "best_work",
      choices: BEST,
    }),
    retention: await insertQuestion(cycle, "Retention", {
      kind: "single_choice",
      role: "retention",
      choices: RETENTION,
    }),
  };
}

beforeAll(async () => {
  await resetQualitative();
  boss = await insertPerson("Jefa Dos");
  ana = await insertPerson("Ana Lectura");
  beto = await insertPerson("Beto Lectura");
  c1 = await insertCycle("Ciclo 1", "2024-06-30");
  c2 = await insertCycle("Ciclo 2", "2024-12-31");
  // Ana in both cycles (counted once in "all cycles"), Beto only in c2.
  for (const cycle of [c1, c2]) {
    const q = await questions(cycle);
    const pa = await insertParticipant(cycle, ana, boss, "Ingeniería");
    await insertAnswer(cycle, pa, ana, "self", [
      {
        questionId: q.well,
        text: "Armé la documentación del proyecto Norte y la usa todo el equipo.",
      },
      {
        questionId: q.improve,
        text: "Necesito mejorar la planificación; estoy trabajando muchas horas de más.",
      },
      { questionId: q.security, text: "Sí." },
      { questionId: q.impact, text: "Sí, con el voluntariado de la escuela." },
      { questionId: q.valued, option: "I feel valued", value: 4 },
      { questionId: q.best, option: "nothing" },
    ]);
    await insertAnswer(cycle, pa, boss, "manager", [
      {
        questionId: q.well,
        text: "Gran trabajo con la documentación y con el equipo.",
      },
      {
        questionId: q.improve,
        text: "Podría mejorar la comunicación con el cliente.",
      },
      { questionId: q.talk, text: "No" },
      { questionId: q.retention, option: "raw text Ana", value: 2 },
    ]);
    if (cycle !== c2) continue;
    const pb = await insertParticipant(cycle, beto, boss, "Ventas");
    await insertAnswer(cycle, pb, beto, "self", [
      { questionId: q.well, text: "n/a" },
      { questionId: q.security, text: "No" },
      { questionId: q.valued, option: "I don't feel valued", value: 1 },
      { questionId: q.best, option: "other", text: "Más capacitación." },
    ]);
    await insertAnswer(cycle, pb, boss, "manager", [
      { questionId: q.well, text: "Buen compañero." },
      { questionId: q.talk, text: "Sí, cada semana." },
      { questionId: q.retention, option: "raw text Beto", value: 5 },
    ]);
  }
  await runAnalysis(db, { provider: new MockProvider() });
}, 60_000);
afterAll(closeDb);

describe("the open-text reading per person", () => {
  it("counts substance per question and side, one person once in all cycles", async () => {
    const all = await substanceByQuestion(db, hr, {});
    const strengthsSelf = all.find(
      (r) => r.dimension === "strengths" && r.side === "self",
    );
    // Ana (latest cycle) and Beto: two people, not three answers.
    expect(strengthsSelf?.people).toBe(2);
    expect(strengthsSelf?.none).toBe(1);
    const strengthsManager = all.find(
      (r) => r.dimension === "strengths" && r.side === "manager",
    );
    expect(strengthsManager?.people).toBe(2);
  });

  it("rates the manager's feedback per group by the weaker answer", async () => {
    const rows = await managerFeedbackByGroup(
      db,
      hr,
      { cycleId: c2 },
      "department",
    );
    const eng = rows.find((r) => r.key === "Ingeniería");
    expect(eng?.people).toBe(1);
    const sales = rows.find((r) => r.key === "Ventas");
    expect((sales?.generic ?? 0) + (sales?.none ?? 0)).toBe(1);
  });

  it("puts the themes of each side next to each other with their bases", async () => {
    const t = await themesBySide(db, hr, {
      cycleId: c2,
      dimension: "strengths",
    });
    // Beto's "n/a" has no substance: not in the self base.
    expect(t.people).toEqual({ self: 1, manager: 2 });
    const doc = t.rows.find((r) => r.theme === "documentacion");
    expect(doc).toMatchObject({ self: 1, manager: 1 });
    expect(doc?.quotes.self.length).toBe(1);
    // Direction: no quotes, and nothing under the minimum.
    expect(
      (
        await themesBySide(db, direction, {
          cycleId: c2,
          dimension: "strengths",
          minGroupSize: 5,
        })
      ).rows,
    ).toEqual([]);
  });

  it("measures agreement and blind spots from the two sides of one participant", async () => {
    const a = await agreementBySide(db, hr, { cycleId: c2 });
    const strengths = a.rows.find((r) => r.dimension === "strengths");
    expect(strengths).toEqual({ dimension: "strengths", both: 1, shared: 1 });
    const improvement = a.rows.find((r) => r.dimension === "improvement");
    expect(improvement?.both).toBe(1);
    // The manager names communication / business, Ana does not.
    expect(a.blindSpots.map((b) => b.theme)).toContain("comunicacion");
    expect(a.blindPeople).toBe(1);
  });

  it("counts people with each signal and crosses them with retention, one row per person", async () => {
    const s = await signalSummary(db, hr, { cycleId: c2 });
    expect(s?.rows.find((r) => r.signal === "workload")).toMatchObject({
      people: 1,
      self: 1,
      manager: 0,
    });
    const ind = await signalsVsIndicators(db, hr, { cycleId: c2 });
    const two = ind.find((r) => r.role === "retention" && r.value === 2);
    expect(two).toMatchObject({ people: 1, withSignal: 1 });
    expect(two?.label?.es).toBe("Retención 2");
    expect(JSON.stringify(ind)).not.toContain("raw text");
  });

  it("rates Sí / No per yes/no question and side, and lists who said No", async () => {
    const rows = await yesNoRates(db, hr, { cycleId: c2 });
    const security = rows.find((r) => r.dimension === "custom_security");
    expect(security).toMatchObject({
      side: "self",
      kind: "security",
      yes: 1,
      no: 1,
      people: 2,
    });
    const talk = rows.find((r) => r.dimension === "custom_talk");
    expect(talk).toMatchObject({
      side: "manager",
      kind: "conversations",
      no: 1,
    });
    const trend = await yesNoTrend(db, hr, {});
    expect(
      trend.filter((t) => t.dimension === "custom_talk").map((t) => t.no),
    ).toEqual([1, 1]);
    const no = await yesNoAnswers(db, hr, {
      cycleId: c2,
      dimension: "custom_security",
      yesNo: "no",
    });
    expect(no.people).toBe(1);
    expect(no.rows.map((r) => r.personName)).toEqual(["Beto Lectura"]);
  });

  it("gives a yes/no question of the app's template (no dimension, no role) a stable key", async () => {
    const native = await insertCycle("Ciclo nativo", "2025-06-30");
    const nativeNext = await insertCycle("Ciclo nativo 2", "2025-12-31");
    for (const cycle of [native, nativeNext]) {
      const q = await insertQuestion(
        cycle,
        "Am I following all Information Security Policies and Procedures?",
        { yesNo: true },
      );
      const p = await insertParticipant(cycle, ana, boss, "Ingeniería");
      await insertAnswer(cycle, p, ana, "self", [
        { questionId: q, option: "no" },
      ]);
    }
    const [a, b] = await Promise.all([
      yesNoRates(db, hr, { cycleId: native }),
      yesNoRates(db, hr, { cycleId: nativeNext }),
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].dimension).toMatch(/^q_[0-9a-f]{10}$/);
    expect(a[0]).toMatchObject({ kind: "security", no: 1, people: 1 });
    // The same question of every cycle shares its key: the drill finds it.
    expect(b[0].dimension).toBe(a[0].dimension);
    const no = await yesNoAnswers(db, hr, {
      cycleId: native,
      dimension: a[0].dimension,
      yesNo: "no",
    });
    expect(no.people).toBe(1);
  });

  it("shows 'valued' as a 1-4 scale and best work as options, never as sentiment", async () => {
    const v = await valuedDistribution(db, hr, { cycleId: c2 }, "department");
    expect(v.total?.counts).toEqual([1, 0, 0, 1]);
    expect(v.total?.notValued).toBe(1);
    expect(v.total?.labels[0]?.es).toBe("No me siento valorado");
    expect(v.byGroup.map((g) => g.key)).toEqual(["Ingeniería", "Ventas"]);
    expect(v.trend.map((t) => t.people)).toEqual([1, 2]);
    const best = await bestWorkOptions(db, hr, { cycleId: c2 });
    expect(best?.people).toBe(2);
    expect(best?.options.find((o) => o.option === "other")?.label?.es).toBe(
      "Otro",
    );
    // Closed answers carry no label: tone has only the open questions.
    const tone = await toneByQuestion(db, hr, { cycleId: c2 });
    expect(tone.map((t) => t.dimension)).not.toContain("valued");
  });

  it("tells where the labels come from and how many people corrected", async () => {
    const before = await readingProvenance(db, hr, { cycleId: c2 });
    expect(before?.demo).toBe(true);
    expect(before?.providers[0]?.provider).toBe("mock");
    expect(before?.lastRun?.provider).toBe("mock");
    const [one] = await db.execute<{ answer_id: string }>(sql`
      select qa.answer_id from qualitative_analysis qa
      join answer a on a.id = qa.answer_id
      join review_request r on r.id = a.request_id
      where r.cycle_id = ${c2}::uuid limit 1`);
    await correctLabel(db, hr, one.answer_id, {
      sentiment: "positive",
      themes: ["equipo"],
    });
    const after = await readingProvenance(db, hr, { cycleId: c2 });
    expect(after?.human).toBe(1);
    expect(after?.labels).toBe(before?.labels);
  });
});
