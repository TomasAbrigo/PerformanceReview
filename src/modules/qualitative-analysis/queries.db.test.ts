import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { table } from "@/modules/exports/csv-test-support";
import { correctLabel } from "./correction";
import { MockProvider } from "./mock-provider";
import {
  listComments,
  sentimentByDimension,
  sentimentTrend,
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

const hr: ActorContext = { personId: null, role: "hr" };
let boss: string;
let other: string;
let emp: string;
let c2023: string;
let c2024: string;
let firstAnswer: string;

beforeAll(async () => {
  await resetQualitative();
  boss = await insertPerson("Silvana Molina");
  other = await insertPerson("Otro Jefe");
  emp = await insertPerson("Adrián Bustos");
  const peer = await insertPerson("Carla Núñez");
  c2023 = await insertCycle("Ciclo 2023", "2023-12-31");
  c2024 = await insertCycle("Ciclo 2024", "2024-12-31");
  for (const cycle of [c2024, c2023]) {
    const well = await insertQuestion(cycle, "What are some things I do well?");
    const improve = await insertQuestion(cycle, "How could I improve?");
    const retention = await insertQuestion(cycle, "If X got an offer", {
      kind: "single_choice",
      role: "retention",
    });
    const a = await insertParticipant(cycle, emp, boss);
    const b = await insertParticipant(cycle, peer, other, "Ventas");
    const ids = await insertAnswer(cycle, a, boss, "manager", [
      { questionId: well, text: "Adrián es referente, ayuda con calidad." },
      {
        questionId: improve,
        text: "Podría mejorar la planificación de sus tiempos.",
      },
      { questionId: retention, option: "A", value: 4 },
    ]);
    if (cycle === c2023) firstAnswer = ids[0];
    // A self review that also answers the retention question, and a second
    // manager review: neither may count the participant's comments twice.
    await insertAnswer(cycle, a, emp, "self", [
      { questionId: retention, option: "D", value: 1 },
    ]);
    await insertAnswer(cycle, a, other, "manager", [
      { questionId: retention, option: "A", value: 4 },
    ]);
    await insertAnswer(cycle, b, other, "manager", [
      {
        questionId: well,
        text: "Carla tiene mucha calidad, gran trabajo en equipo.",
      },
      { questionId: improve, text: "Siempre llega tarde, un problema." },
      { questionId: retention, option: "B", value: 2 },
    ]);
  }
  await runAnalysis(db, { provider: new MockProvider() });
}, 30_000);
afterAll(closeDb);

describe("qualitative queries", () => {
  it("sentiment by dimension (HR: everyone; filters)", async () => {
    const rows = await sentimentByDimension(db, hr, { cycleId: c2023 });
    // The tone itself is the mock's (its cues change); the counts are fixed.
    expect(rows.map((r) => [r.dimension, r.total])).toEqual([
      ["improvement", 2],
      ["strengths", 2],
    ]);
    const ventas = await sentimentByDimension(db, hr, {
      cycleId: c2023,
      department: "Ventas",
    });
    expect(ventas.reduce((n, r) => n + r.total, 0)).toBe(2);
  });

  it("filters by the relationship of the review", async () => {
    // The fixture's open-text answers are all from manager reviews.
    expect(
      await sentimentByDimension(db, hr, {
        cycleId: c2023,
        relationship: "self",
      }),
    ).toEqual([]);
    expect(
      await sentimentByDimension(db, hr, {
        cycleId: c2023,
        relationship: "manager",
      }),
    ).toEqual(await sentimentByDimension(db, hr, { cycleId: c2023 }));
    expect(
      await topThemes(db, hr, { cycleId: c2023, relationship: "self" }),
    ).toEqual([]);
  });

  it("manager: only direct reports of the snapshot; employee: nothing", async () => {
    const mgr: ActorContext = { personId: boss, role: "manager" };
    const rows = await listComments(db, mgr, { cycleId: c2023 });
    expect(rows.map((r) => r.personName)).toEqual([
      "Adrián Bustos",
      "Adrián Bustos",
    ]);
    const employee: ActorContext = { personId: emp, role: "employee" };
    expect(await listComments(db, employee, {})).toEqual([]);
    expect(await sentimentByDimension(db, employee, {})).toEqual([]);
    expect(await topThemes(db, employee, {})).toEqual([]);
    expect(await sentimentTrend(db, employee, {})).toEqual([]);
  });

  it("aggregate view: counts but no comments or quotes", async () => {
    expect(await listComments(db, hr, { aggregateOnly: true })).toEqual([]);
    const themes = await topThemes(db, hr, { aggregateOnly: true });
    expect(themes.length).toBeGreaterThan(0);
    expect(themes.every((t) => t.quotes.length === 0)).toBe(true);
  });

  it("trend across cycles ordered by period", async () => {
    const trend = await sentimentTrend(db, hr, { dimension: "strengths" });
    expect(trend.map((t) => t.cycleName)).toEqual(["Ciclo 2023", "Ciclo 2024"]);
    expect(trend[0]).toMatchObject({ positive: 2, total: 2 });
  });

  it("top themes with pseudonymized quotes", async () => {
    const themes = await topThemes(db, hr, { cycleId: c2023 });
    const calidad = themes.find((t) => t.theme === "calidad")!;
    expect(calidad.count).toBe(2);
    expect(calidad.quotes.length).toBe(2);
    expect(calidad.quotes.join(" ")).not.toMatch(/adri[aá]n|carla/i);
    expect(calidad.quotes.join(" ")).toMatch(/\[P\d\]/);
  });

  it("a correction is the effective label", async () => {
    await correctLabel(db, hr, firstAnswer, {
      sentiment: "negative",
      themes: ["x"],
    });
    const rows = await listComments(db, hr, {
      cycleId: c2023,
      sentiment: "negative",
    });
    expect(rows.find((r) => r.answerId === firstAnswer)).toMatchObject({
      source: "human",
      themes: ["x"],
      confidence: null,
    });
  });

  it("sentiment vs retention / engagement answers", async () => {
    const rows = await sentimentVsIndicators(db, hr, { cycleId: c2024 });
    // Labelled by value with the question's choices (choiceOfValue).
    expect(rows.map((r) => [r.role, r.value, r.total])).toEqual([
      ["retention", 4, 2],
      ["retention", 2, 2],
    ]);
    expect(rows.every((r) => !("option" in r))).toBe(true);
  });

  it("counts only open text against the indicators, never a closed answer (#133)", async () => {
    const cycle = await insertCycle("Ciclo 2025", "2025-12-31");
    const well = await insertQuestion(cycle, "What are some things I do well?");
    const bestWork = await insertQuestion(cycle, "Best work", {
      kind: "single_choice",
    });
    const retention = await insertQuestion(cycle, "If X got an offer", {
      kind: "single_choice",
      role: "retention",
    });
    const a = await insertParticipant(cycle, emp, boss);
    await insertAnswer(cycle, a, boss, "manager", [
      { questionId: well, text: "Adrián es referente, ayuda con calidad." },
      {
        questionId: bestWork,
        option: "B",
        text: "Lideró la migración del proyecto con calidad.",
      },
      { questionId: retention, option: "A", value: 4 },
    ]);
    await runAnalysis(db, { provider: new MockProvider() });
    const all = await sentimentTotals(db, hr, { cycleId: cycle });
    expect(all?.total).toBe(2);
    const rows = await sentimentVsIndicators(db, hr, { cycleId: cycle });
    expect(rows.map((r) => [r.role, r.value, r.total])).toEqual([
      ["retention", 4, 1],
    ]);
  });

  it("narrows the comments to a manager's answer to an indicator", async () => {
    const four = await listComments(db, hr, {
      cycleId: c2024,
      indicator: { role: "retention", value: 4 },
    });
    expect(four.map((c) => c.personName)).toEqual([
      "Adrián Bustos",
      "Adrián Bustos",
    ]);
    // The self review's "D" (1) is not the manager's answer.
    expect(
      await sentimentTotals(db, hr, {
        cycleId: c2024,
        indicator: { role: "retention", value: 1 },
      }),
    ).toMatchObject({ total: 0 });
  });

  it("exports insights-sentiment.csv with counts only", async () => {
    const { header, rows } = await table(
      "insights-sentiment.csv",
      `?cycle=${c2024}&locale=en`,
    );
    // In people (#129): Adrián and Carla, each once per question; the manager
    // side only. The numbers of the rest are in reading-exports.db.test.ts.
    expect(header.slice(0, 3)).toEqual(["dimension", "side", "people"]);
    expect(header).not.toContain("total");
    expect(rows.map((r) => [r.dimension, r.side, r.people])).toEqual([
      ["improvement", "manager", "2"],
      ["strengths", "manager", "2"],
    ]);
  });

  it("direction: aggregates only, small groups left out", async () => {
    const direction: ActorContext = { personId: null, role: "direction" };
    expect(await listComments(db, direction, {})).toEqual([]);
    const themes = await topThemes(db, direction, {});
    expect(themes.every((t) => t.quotes.length === 0)).toBe(true);
    // Two participants per cycle: below the default minimum group size.
    expect(
      await sentimentByDimension(db, direction, { cycleId: c2023 }),
    ).toEqual([]);
    const hrCounts = await sentimentByDimension(db, hr, {
      cycleId: c2023,
      aggregateOnly: true,
    });
    expect(hrCounts.length).toBeGreaterThan(0);
  });
});
