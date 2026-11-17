import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { setSetting } from "@/modules/settings/service";
import { table } from "@/modules/exports/csv-test-support";
import { correctLabel } from "./correction";
import { importLabels } from "./import-labels";
import { MockProvider } from "./mock-provider";
import {
  listComments,
  qualitativeFilterOptions,
  sentimentByDimension,
  sentimentTotals,
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

const hr: ActorContext = { personId: null, role: "hr" };
let cycle: string;
let boss: string;
let ana: string;
let valuedQ: string;
let retentionQ: string;
let strengthsQ: string;
let weirdQ: string;
let valuedAnswers: string[] = [];
let strengthsAnswers: string[] = [];

const CHOICES = [
  { value: "high", label: { es: "Muy bien", en: "Very well" } },
  { value: "none", label: { es: "Para nada", en: "Not at all" } },
  { value: "mid", label: { es: "Regular", en: "Somewhat" } },
];

beforeAll(async () => {
  await resetQualitative();
  await db.execute(sql`delete from app_setting where key like 'analysis.%'`);
  boss = await insertPerson("Jefe Uno");
  ana = await insertPerson("Ana Ejemplo");
  const bea = await insertPerson("Bea Ejemplo");
  cycle = await insertCycle("Ciclo 2024", "2024-09-25");
  strengthsQ = await insertQuestion(cycle, "What do you do well?", {
    dimension: "strengths",
  });
  weirdQ = await insertQuestion(cycle, "¿Qué opinás del onboarding?", {
    dimension: "onboarding_q",
  });
  valuedQ = await insertQuestion(
    cycle,
    "How well does the company recognize my value?",
    {
      kind: "single_choice",
      dimension: "valued",
      choices: CHOICES,
    },
  );
  retentionQ = await insertQuestion(cycle, "Would stay?", {
    kind: "single_choice",
    role: "retention",
    choices: CHOICES,
  });
  const pa = await insertParticipant(cycle, ana, boss);
  const pb = await insertParticipant(cycle, bea, boss);
  // Self side of Ana: a mixed comment and a closed answer.
  const self = await insertAnswer(cycle, pa, ana, "self", [
    {
      questionId: strengthsQ,
      text: "Gran calidad y confiable, pero siempre llego tarde y hay retrabajo.",
    },
    { questionId: valuedQ, option: "mid" },
    { questionId: retentionQ, option: "high" },
    {
      questionId: weirdQ,
      text: "Fue lento y el proyecto cambió de alcance varias veces.",
    },
  ]);
  // Manager side of Ana: positive and closed.
  const mgr = await insertAnswer(cycle, pa, boss, "manager", [
    {
      questionId: strengthsQ,
      text: "Excelente trabajo en equipo, muy confiable.",
    },
    { questionId: valuedQ, option: "high" },
  ]);
  // Bea, manager side only: negative + closed negative.
  const bm = await insertAnswer(cycle, pb, boss, "manager", [
    { questionId: strengthsQ, text: "Ok" },
    { questionId: valuedQ, option: "none" },
  ]);
  strengthsAnswers = [self[0], mgr[0], bm[0]];
  valuedAnswers = [self[1], mgr[1], bm[1]];
  await runAnalysis(db, { provider: new MockProvider() });
}, 30_000);
afterAll(async () => {
  await db.execute(sql`delete from app_setting where key like 'analysis.%'`);
  await closeDb();
});

const bySentiment = (rows: { dimension: string; total: number }[], d: string) =>
  rows.find((r) => r.dimension === d);

describe("five sentiments", () => {
  it("counts neutral and mixed beside the other three", async () => {
    const rows = await sentimentByDimension(db, hr, { cycleId: cycle });
    expect(bySentiment(rows, "strengths")).toMatchObject({
      positive: 1,
      mixed: 1,
      neutral: 1,
      constructive: 0,
      negative: 0,
      total: 3,
    });
  });

  it("totals (the KPIs) add every sentiment", async () => {
    const totals = await sentimentTotals(db, hr, { cycleId: cycle });
    expect(totals).toEqual({
      positive: 2,
      constructive: 1,
      neutral: 2,
      mixed: 1,
      negative: 1,
      total: 7,
    });
  });
});

describe("authorization is unchanged", () => {
  it("manager: their reports; direction: aggregates over the minimum; employee: nothing", async () => {
    const mgr: ActorContext = { personId: boss, role: "manager" };
    expect((await sentimentTotals(db, mgr, { cycleId: cycle }))?.total).toBe(7);
    expect(await listComments(db, mgr, { cycleId: cycle })).toHaveLength(7);
    const other: ActorContext = { personId: ana, role: "manager" };
    expect((await sentimentTotals(db, other, { cycleId: cycle }))?.total).toBe(
      0,
    );
    const employee: ActorContext = { personId: ana, role: "employee" };
    expect(await sentimentTotals(db, employee, { cycleId: cycle })).toBeNull();
    expect(await listComments(db, employee, {})).toEqual([]);
    // Two people: below the default minimum group size of 5.
    const direction: ActorContext = { personId: null, role: "direction" };
    expect(await sentimentTotals(db, direction, { cycleId: cycle })).toBeNull();
    expect(await listComments(db, direction, {})).toEqual([]);
    expect(await topThemes(db, direction, {})).toEqual([]);
  });
});

describe("closed questions", () => {
  it("labels the answers of closed questions with a dimension, by the label of the chosen option", async () => {
    const comments = await listComments(db, hr, {
      cycleId: cycle,
      dimension: "valued",
    });
    expect(
      Object.fromEntries(comments.map((c) => [c.text, c.sentiment])),
    ).toEqual({
      Regular: "neutral",
      "Muy bien": "positive",
      "Para nada": "negative",
    });
    // A closed question without dimension (retention) is not analyzed.
    const all = await listComments(db, hr, { cycleId: cycle });
    expect(all).toHaveLength(7);
    expect(all.map((c) => c.dimension)).not.toContain("other");
  });

  it("an unknown dimension key shows up as is, with its question prompt for the label", async () => {
    const options = await qualitativeFilterOptions(db);
    expect(options.dimensions).toEqual(
      expect.arrayContaining(["strengths", "valued", "onboarding_q"]),
    );
    expect(options.dimensionPrompts.onboarding_q).toEqual({
      es: "¿Qué opinás del onboarding?",
      en: "¿Qué opinás del onboarding?",
    });
  });

  it("a changed option makes the label stale (until the next run)", async () => {
    const before = (await listComments(db, hr, { dimension: "valued" })).length;
    await db.execute(
      sql`update answer set option_label = 'none' where id = ${valuedAnswers[0]}::uuid`,
    );
    expect(await listComments(db, hr, { dimension: "valued" })).toHaveLength(
      before - 1,
    );
    const rerun = await runAnalysis(db, { provider: new MockProvider() });
    expect(rerun.analyzed).toBe(1);
    expect(await listComments(db, hr, { dimension: "valued" })).toHaveLength(
      before,
    );
  });

  it("includeClosed=false leaves them out of the analysis and of the views", async () => {
    await setSetting(db, hr, "analysis.includeClosed", false);
    try {
      const comments = await listComments(db, hr, { cycleId: cycle });
      expect(comments.map((c) => c.dimension)).not.toContain("valued");
      expect(comments).toHaveLength(4);
      expect((await sentimentTotals(db, hr, { cycleId: cycle }))?.total).toBe(
        4,
      );
      const run = await runAnalysis(db, { provider: new MockProvider() });
      expect(run.total).toBe(4);
    } finally {
      await setSetting(db, hr, "analysis.includeClosed", true);
    }
    expect((await sentimentTotals(db, hr, { cycleId: cycle }))?.total).toBe(7);
  });
});

describe("self vs manager", () => {
  it("every block honors the relationship filter", async () => {
    const self = { cycleId: cycle, relationship: "self" as const };
    const manager = { cycleId: cycle, relationship: "manager" as const };
    expect((await sentimentTotals(db, hr, self))?.total).toBe(3);
    expect((await sentimentTotals(db, hr, manager))?.total).toBe(4);
    const selfDims = await sentimentByDimension(db, hr, self);
    expect(selfDims.reduce((n, r) => n + r.total, 0)).toBe(3);
    expect(bySentiment(selfDims, "strengths")).toMatchObject({
      mixed: 1,
      total: 1,
    });
    const comments = await listComments(db, hr, self);
    expect(comments.every((c) => c.relationship === "self")).toBe(true);
    const themes = await topThemes(db, hr, self);
    expect(themes.reduce((n, t) => n + t.count, 0)).toBeGreaterThan(0);
    const managerThemes = await topThemes(db, hr, manager);
    for (const t of [...themes, ...managerThemes]) {
      expect(t.sentiment.total).toBe(t.count);
    }
  });

  it("the CSV honors it too, with the five sentiments", async () => {
    const { header, rows } = await table(
      "insights-sentiment.csv",
      `?cycle=${cycle}&relationship=self&locale=es`,
    );
    expect(header).toEqual([
      "dimensión",
      "positivo",
      "constructivo",
      "neutral",
      "mixto",
      "negativo",
      "total",
    ]);
    expect(rows.reduce((n, r) => n + Number(r.total), 0)).toBe(3);
  });
});

describe("themes", () => {
  it("rank with their sentiment and quotes", async () => {
    const themes = await topThemes(db, hr, { cycleId: cycle });
    const equipo = themes.find((t) => t.theme === "equipo");
    expect(equipo).toBeDefined();
    expect(equipo!.sentiment.positive).toBeGreaterThan(0);
  });
  it("the initial vocabulary is always offered (and catalogued per dimension)", async () => {
    const options = await qualitativeFilterOptions(db);
    expect(options.themes).toEqual(
      expect.arrayContaining([
        "proyecto",
        "equipo",
        "comunicacion",
        "crecimiento",
        "cultura",
        "procesos",
        "bienestar",
        "reconocimiento",
      ]),
    );
    const [{ n }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from theme where dimension = 'valued' and normalized_name = 'bienestar'`,
    );
    expect(n).toBe(1);
  });
});

describe("corrections and label import with five sentiments", () => {
  it("HR can correct a comment to neutral or mixed", async () => {
    for (const sentiment of ["neutral", "mixed"] as const) {
      await correctLabel(db, hr, strengthsAnswers[1], {
        sentiment,
        themes: ["cultura"],
      });
      const [c] = (
        await listComments(db, hr, { cycleId: cycle, sentiment })
      ).filter((x) => x.answerId === strengthsAnswers[1]);
      expect(c).toMatchObject({ source: "human", sentiment });
    }
  });

  it("a closed answer can be corrected too", async () => {
    await correctLabel(db, hr, valuedAnswers[2], {
      sentiment: "mixed",
      themes: [],
    });
    const rows = await listComments(db, hr, { dimension: "valued" });
    expect(rows.find((r) => r.answerId === valuedAnswers[2])?.sentiment).toBe(
      "mixed",
    );
  });

  it("the label CSV accepts the five values in Spanish and English", async () => {
    const result = await importLabels(db, {
      rows: [
        ["Positivo", "strengths"],
        ["Constructivo", "strengths"],
        ["neutral", "strengths"],
        ["MIXTO", "strengths"],
        ["Negative", "strengths"],
        ["Mixed", "strengths"],
        ["Neutro", "strengths"],
        ["feliz", "strengths"],
      ].map(([sentiment, dimension]) => ({
        employee_name: "Bea Ejemplo",
        review_cycle: "Ciclo 2024",
        dimension,
        sentiment,
      })),
    });
    expect(result.unmatched.map((u) => u.reason)).toEqual([
      "invalid_sentiment",
    ]);
    expect(result.matched).toBe(7);
    const [row] = await db.execute<{ sentiment: string }>(sql`
      select sentiment from qualitative_analysis
      where provider = 'import' and answer_id = ${strengthsAnswers[2]}::uuid`);
    // Last matching row wins: "Neutro".
    expect(row.sentiment).toBe("neutral");
  });
});
