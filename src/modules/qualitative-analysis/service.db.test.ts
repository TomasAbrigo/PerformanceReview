import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { yesNoAnswerSql } from "./analysis-text";
import { correctLabel } from "./correction";
import { importLabels } from "./import-labels";
import { effectiveCte } from "./effective";
import { MockProvider } from "./mock-provider";
import type { AnalysisInput, AnalysisProvider } from "./provider";
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

/** Records every batch it is sent; labels with the mock. */
class SpyProvider implements AnalysisProvider {
  readonly name = "spy";
  readonly promptVersion = "spy-v1";
  readonly batchSize = 2;
  calls: AnalysisInput[][] = [];
  private mock = new MockProvider();
  async analyze(batch: AnalysisInput[]) {
    this.calls.push(batch);
    return this.mock.analyze(batch);
  }
  get sent() {
    return this.calls.flat();
  }
}

let cycle: string;
let answers: string[];

beforeEach(async () => {
  await resetQualitative();
  const boss = await insertPerson("Silvana Molina", {
    email: "silvana.molina@example.test",
    employeeNumber: "E-0001",
  });
  const emp = await insertPerson("Adrián Bustos", {
    email: "adrian.bustos@example.test",
    employeeNumber: "4471",
  });
  cycle = await insertCycle("Evaluación 2023", "2023-12-31");
  const well = await insertQuestion(cycle, "What are some things I do well?");
  const improve = await insertQuestion(cycle, "How could I improve?");
  const choice = await insertQuestion(cycle, "Q1", { kind: "single_choice" });
  const cp = await insertParticipant(cycle, emp, boss);
  answers = await insertAnswer(cycle, cp, emp, "self", [
    {
      questionId: well,
      text: "Adrián es referente; ayuda a Silvana con calidad.",
    },
    {
      questionId: improve,
      text: "Bustos podría mejorar la planificación. Mail: adrian.bustos@example.test, legajo 4471",
    },
    { questionId: choice, option: "A" },
  ]);
  answers.push(
    ...(await insertAnswer(cycle, cp, boss, "manager", [
      {
        questionId: well,
        text: "MOLINA dice: excelente comunicación (E-0001).",
      },
      { questionId: improve, text: "   " },
    ])),
  );
});

afterAll(closeDb);

describe("runAnalysis", () => {
  it("labels open texts in batches, pseudonymized, and records the run without content", async () => {
    const spy = new SpyProvider();
    const result = await runAnalysis(db, { cycleId: cycle, provider: spy });
    expect(result).toMatchObject({ total: 3, analyzed: 3, cached: 0 });
    expect(spy.calls.map((c) => c.length)).toEqual([2, 1]);
    const sent = spy.sent.map((s) => s.text).join("\n");
    expect(sent).not.toMatch(/adri[aá]n|bustos|silvana|molina|@|4471|E-0001/i);
    expect(sent).toContain("[P1]");
    expect(spy.sent.map((s) => s.dimension).sort()).toEqual([
      "improvement",
      "strengths",
      "strengths",
    ]);
    const labels = await db.execute<{ dimension: string; sentiment: string }>(
      sql`select dimension, sentiment from qualitative_analysis order by dimension`,
    );
    expect(labels).toHaveLength(3);
    const [run] = await db.execute<Record<string, unknown>>(
      sql`select * from analysis_run`,
    );
    expect(run).toMatchObject({
      provider: "spy",
      prompt_version: "spy-v1",
      status: "succeeded",
      texts_total: 3,
      texts_analyzed: 3,
      texts_cached: 0,
    });
    const themes = await db.execute(sql`select * from theme`);
    expect(themes.length).toBeGreaterThan(0);
  });

  it("a second run sends nothing (cache by text hash + prompt version)", async () => {
    await runAnalysis(db, { provider: new SpyProvider() });
    const spy = new SpyProvider();
    const second = await runAnalysis(db, { provider: spy });
    expect(spy.sent).toHaveLength(0);
    expect(second).toMatchObject({ total: 3, analyzed: 0, cached: 3 });
    // An edited text is analyzed again.
    await db.execute(
      sql`update answer set text_value = 'Ahora llega tarde, un problema' where id = ${answers[0]}::uuid`,
    );
    const third = new SpyProvider();
    await runAnalysis(db, { provider: third });
    expect(third.sent).toHaveLength(1);
  });

  it("never overwrites a human correction", async () => {
    await runAnalysis(db, { provider: new SpyProvider() });
    await correctLabel(db, hr, answers[0], {
      sentiment: "negative",
      themes: ["Puntualidad"],
      reason: "mal etiquetado",
    });
    await db.execute(
      sql`update answer set text_value = 'Excelente, gran referente' where id = ${answers[0]}::uuid`,
    );
    const spy = new SpyProvider();
    const r = await runAnalysis(db, { provider: spy });
    expect(spy.sent.map((s) => s.text)).not.toContain(
      "Excelente, gran referente",
    );
    expect(r.corrected).toBe(1);
    const [eff] = await db.execute<{ sentiment: string; themes: string[] }>(sql`
      select new_sentiment as sentiment, new_themes as themes from analysis_correction`);
    expect(eff).toEqual({ sentiment: "negative", themes: ["puntualidad"] });
    const audit = await db.execute<{ action: string; note: string }>(
      sql`select action, note from admin_audit_log`,
    );
    expect(audit).toEqual([
      { action: "qualitative_label_corrected", note: "mal etiquetado" },
    ]);
  });

  it("only HR corrects; a failing provider marks the run as error", async () => {
    await expect(
      correctLabel(db, { personId: null, role: "manager" }, answers[0], {
        sentiment: "positive",
        themes: [],
      }),
    ).rejects.toThrow(/forbidden/);
    const failing: AnalysisProvider = {
      name: "boom",
      promptVersion: "v",
      analyze: async () => {
        throw new Error("network down");
      },
    };
    await expect(runAnalysis(db, { provider: failing })).rejects.toThrow();
    const [run] = await db.execute<{ status: string; error: string }>(
      sql`select status, error from analysis_run`,
    );
    expect(run).toEqual({ status: "error", error: "Error" });
  });

  it("refuses to correct a comment without a label", async () => {
    await expect(
      correctLabel(db, hr, answers[0], { sentiment: "negative", themes: [] }),
    ).rejects.toThrow(/not_labeled/);
  });

  it("skips answers of removed participants and draft requests", async () => {
    await db.execute(sql`update cycle_participant set removed_at = now()`);
    const spy = new SpyProvider();
    expect((await runAnalysis(db, { provider: spy })).total).toBe(0);
  });

  it("a label made from an older text is stale: hidden until re-analyzed", async () => {
    await runAnalysis(db, { provider: new SpyProvider() });
    // Whitespace-only edit: same normalized hash, different text.
    await db.execute(
      sql`update answer set text_value = text_value || '  ' where id = ${answers[0]}::uuid`,
    );
    const [{ n }] = await db.execute<{ n: number }>(sql`
      with ${effectiveCte()} select count(*)::int as n from eff`);
    expect(n).toBe(2);
    const spy = new SpyProvider();
    await runAnalysis(db, { provider: spy });
    expect(spy.sent).toHaveLength(1);
    const [{ m }] = await db.execute<{ m: number }>(sql`
      with ${effectiveCte()} select count(*)::int as m from eff`);
    expect(m).toBe(3);
  });
});

describe("open-text reading (#128)", () => {
  type Eff = {
    answer_id: string;
    yes_no_question: boolean;
    themes: string[];
    substance: string | null;
    signals: string[];
    origin: string;
    provider: string;
    model: string | null;
    demo: boolean;
    confidence: number | null;
    sentiment: string;
  };
  const effOf = async (answerId: string) => {
    const [row] = await db.execute<Eff>(sql`
      with ${effectiveCte()} select * from eff where answer_id = ${answerId}::uuid`);
    return row;
  };

  it("sends the question, who writes about whom and the rubric; stores substance and signals", async () => {
    const spy = new SpyProvider();
    await runAnalysis(db, { cycleId: cycle, provider: spy });
    const improve = spy.sent.find((s) => s.dimension === "improvement")!;
    expect(improve).toMatchObject({
      rubric: "improvement",
      relationship: "self",
      yesNo: null,
      question: { es: "How could I improve?", en: "How could I improve?" },
    });
    expect(spy.sent.filter((s) => s.relationship === "manager")).toHaveLength(
      1,
    );
    const label = await effOf(answers[1]);
    expect(label.substance).not.toBeNull();
    expect(Array.isArray(label.signals)).toBe(true);
    expect(label).toMatchObject({ origin: "machine", provider: "spy" });
  });

  it("the mock is a demo heuristic: no confidence, flagged in eff", async () => {
    await runAnalysis(db, { provider: new MockProvider() });
    expect(await effOf(answers[0])).toMatchObject({
      provider: "mock",
      origin: "machine",
      demo: true,
      confidence: null,
      model: null,
    });
  });

  it("a chosen option is never read; the text typed next to it is", async () => {
    await db.execute(
      sql`update answer set text_value = 'Otro: más feedback del cliente' where id = ${answers[2]}::uuid`,
    );
    const spy = new SpyProvider();
    await runAnalysis(db, { provider: spy });
    const typed = spy.sent.find((s) => s.text.startsWith("Otro"));
    expect(typed?.rubric).toBe("open");
    expect(spy.sent).toHaveLength(4);
  });

  it("a yes/no question: the yes/no resolved and only the 'how' read; a bare yes/no is not", async () => {
    const q = await insertQuestion(
      cycle,
      'Do I contribute with initiatives related to "Social impact"? How?',
      { dimension: "custom_social", yesNo: true },
    );
    const emp = await insertPerson("Otra Persona");
    const cp = await insertParticipant(cycle, emp, null);
    const [how] = await insertAnswer(cycle, cp, emp, "self", [
      { questionId: q, text: "Sí, con el voluntariado del barrio." },
    ]);
    const emp2 = await insertPerson("Tercera Persona");
    const cp2 = await insertParticipant(cycle, emp2, null);
    await insertAnswer(cycle, cp2, emp2, "self", [
      { questionId: q, text: "No" },
    ]);
    const spy = new SpyProvider();
    await runAnalysis(db, { provider: spy });
    const sent = spy.sent.filter((s) => s.dimension === "custom_social");
    expect(sent).toEqual([
      expect.objectContaining({
        rubric: "yes_no_detail",
        yesNo: "yes",
        text: "con el voluntariado del barrio.",
      }),
    ]);
    expect((await effOf(how)).yes_no_question).toBe(true);
    const counts = await db.execute<{ yes_no: string | null }>(sql`
      select ${yesNoAnswerSql()} as yes_no from answer a
      join question_revision q on q.id = a.question_revision_id
      where q.id = ${q}::uuid order by 1`);
    expect(counts.map((c) => c.yes_no)).toEqual(["no", "yes"]);
  });

  it("precedence: a human correction > an imported label > a later machine label", async () => {
    await runAnalysis(db, { provider: new SpyProvider() });
    await importLabels(db, {
      rows: [
        {
          employee_name: "Adrián Bustos",
          review_cycle: "Evaluación 2023",
          dimension: "improvement",
          sentiment: "negative",
          themes: "colaboracion",
        },
      ],
    });
    // A later run of another provider does not override the import.
    await runAnalysis(db, { provider: new MockProvider() });
    expect(await effOf(answers[1])).toMatchObject({
      origin: "import",
      provider: "import",
      sentiment: "negative",
      substance: null,
      themes: ["equipo"],
    });
    await correctLabel(db, hr, answers[1], {
      sentiment: "constructive",
      themes: ["planificacion"],
      substance: "specific",
      signals: ["workload"],
    });
    expect(await effOf(answers[1])).toMatchObject({
      origin: "human",
      provider: "human",
      sentiment: "constructive",
      substance: "specific",
      signals: ["workload"],
      confidence: null,
    });
  });

  it("a correction without substance or signals keeps the label's", async () => {
    await runAnalysis(db, { provider: new MockProvider() });
    const before = await effOf(answers[0]);
    await correctLabel(db, hr, answers[0], {
      sentiment: "negative",
      themes: [],
    });
    expect(await effOf(answers[0])).toMatchObject({
      substance: before.substance,
      signals: before.signals,
      sentiment: "negative",
    });
  });
});
