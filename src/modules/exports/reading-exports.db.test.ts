import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import type { ActorContext } from "@/modules/actor/types";
import { selfAssessmentReport } from "@/modules/insights/self-assessment";
import { setOrgAttributes } from "@/modules/org-attributes/test-support";
import { sentiments, signals } from "@/modules/qualitative-analysis";
import { MockProvider } from "@/modules/qualitative-analysis/mock-provider";
import {
  bestWorkOptions,
  managerFeedbackByGroup,
  signalsByGroup,
  signalSummary,
  substanceByQuestion,
  toneByQuestion,
  valuedDistribution,
  yesNoByGroup,
  yesNoRates,
} from "@/modules/qualitative-analysis/reading";
import { runAnalysis } from "@/modules/qualitative-analysis/service";
import {
  insertAnswer,
  insertCycle,
  insertParticipant,
  insertPerson,
  insertQuestion,
  resetQualitative,
} from "@/modules/qualitative-analysis/test-support";
import { download, table } from "./csv-test-support";

/**
 * The open-text reading CSVs (#129) say the numbers of the screen: each file
 * is compared with the reader of `reading.ts` the screen calls, for the same
 * filters. The unit is the person (Ana answers in two cycles and counts once
 * in "all cycles"), self and manager never share a row, and no file carries
 * text or names.
 */
const hr: ActorContext = { personId: null, role: "hr" };
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
  };
}

beforeAll(async () => {
  await resetQualitative();
  const boss = await insertPerson("Jefa Exportada");
  const ana = await insertPerson("Ana Exportada");
  const beto = await insertPerson("Beto Exportado");
  const carla = await insertPerson("Carla Exportada");
  const dani = await insertPerson("Dani Exportado");
  c1 = await insertCycle("Ciclo 1", "2024-06-30");
  c2 = await insertCycle("Ciclo 2", "2024-12-31");
  await setOrgAttributes(ana, { account: "Cuenta A" });
  await setOrgAttributes(beto, { account: "Cuenta B" });
  await setOrgAttributes(carla, { account: "Cuenta B" });
  await setOrgAttributes(dani, { account: "Cuenta B" });
  // Ana answers in both cycles (one person in "all cycles"), the others in c2.
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
    ]);
    if (cycle !== c2) continue;
    for (const [person, department] of [
      [beto, "Ventas"],
      [carla, "Ventas"],
      [dani, "Ingeniería"],
    ] as const) {
      const p = await insertParticipant(cycle, person, boss, department);
      await insertAnswer(cycle, p, person, "self", [
        {
          questionId: q.well,
          text: person === beto ? "n/a" : "Soy colaborativa y ayudo al equipo.",
        },
        { questionId: q.security, text: person === dani ? "Sí" : "No" },
        { questionId: q.valued, option: "I don't feel valued", value: 1 },
        { questionId: q.best, option: "other", text: "Más capacitación." },
      ]);
      await insertAnswer(cycle, p, boss, "manager", [
        { questionId: q.well, text: "Buen compañero." },
        { questionId: q.talk, text: "Sí, cada semana." },
      ]);
    }
  }
  await runAnalysis(db, { provider: new MockProvider() });
}, 60_000);
afterAll(closeDb);

const num = (n: string | undefined) => Number(n);
const one = (n: number | null) => (n === null ? "" : String(n));

describe("insights-sentiment.csv: the reading per question and side, in people", () => {
  it("has the people columns, not the old counts by answer", async () => {
    const { header } = await table("insights-sentiment.csv", "?locale=en");
    expect(header).toEqual([
      "dimension",
      "side",
      "people",
      "substance_people",
      "substance_none",
      "substance_generic",
      "substance_specific",
      "substance_none_pct",
      "substance_generic_pct",
      "substance_specific_pct",
      "signal_any",
      ...signals.map((s) => `signal_${s}`),
      ...sentiments,
    ]);
    const es = await table("insights-sentiment.csv", "?locale=es");
    expect(es.header.slice(0, 3)).toEqual(["dimensión", "lado", "personas"]);
    expect(es.header).toContain("señal: carga de trabajo");
    expect(es.header).toContain("positivo");
  });

  it("says what the reader says, per question and side, for the same filters", async () => {
    for (const [query, f] of [
      ["", {}],
      [`&cycle=${c2}`, { cycleId: c2 }],
      [`&cycle=${c2}&department=Ventas`, { cycleId: c2, department: "Ventas" }],
      [`&account=Cuenta%20B`, { account: "Cuenta B" }],
      [
        `&cycle=${c2}&relationship=manager`,
        { cycleId: c2, relationship: "manager" as const },
      ],
    ] as const) {
      const { rows } = await table(
        "insights-sentiment.csv",
        `?locale=en${query}`,
      );
      const substance = await substanceByQuestion(db, hr, f);
      const tone = await toneByQuestion(db, hr, f);
      const keys = new Set([
        ...substance.map((r) => `${r.dimension}|${r.side}`),
        ...tone.map((r) => `${r.dimension}|${r.side}`),
      ]);
      expect(rows.map((r) => `${r.dimension}|${r.side}`).sort()).toEqual(
        [...keys].sort(),
      );
      for (const r of rows) {
        const s = substance.find(
          (x) => x.dimension === r.dimension && x.side === r.side,
        );
        const t = tone.find(
          (x) => x.dimension === r.dimension && x.side === r.side,
        );
        const sig = await signalSummary(db, hr, {
          ...f,
          dimension: r.dimension,
          relationship: r.side as "self" | "manager",
        });
        expect(num(r.people)).toBe(t?.people ?? 0);
        expect(num(r.substance_people)).toBe(s?.people ?? 0);
        expect(num(r.substance_none)).toBe(s?.none ?? 0);
        expect(num(r.substance_generic)).toBe(s?.generic ?? 0);
        expect(num(r.substance_specific)).toBe(s?.specific ?? 0);
        expect(num(r.signal_any)).toBe(sig?.withAny ?? 0);
        for (const sg of signals) {
          expect(num(r[`signal_${sg}`])).toBe(
            sig?.rows.find((x) => x.signal === sg)?.people ?? 0,
          );
        }
        for (const se of sentiments) expect(num(r[se])).toBe(t?.[se] ?? 0);
      }
    }
  });

  it("counts people, not answers: Ana's two cycles are one person; self and manager never share a row", async () => {
    const { rows } = await table("insights-sentiment.csv", "?locale=en");
    const strengths = (side: string) =>
      rows.find((r) => r.dimension === "strengths" && r.side === side);
    // Ana, Beto, Carla, Dani: four people (Ana has two answers).
    expect(strengths("self")?.people).toBe("4");
    expect(strengths("manager")?.people).toBe("4");
    expect(rows.filter((r) => r.dimension === "strengths")).toHaveLength(2);
    // The shares are of the people with a substance (Beto's "n/a" is none).
    const self = strengths("self")!;
    expect(self.substance_none).toBe("1");
    expect(num(self.substance_none_pct)).toBeCloseTo(
      (1 / num(self.substance_people)) * 100,
      1,
    );
    // A chosen option is never read (no "valued" row); only the text typed
    // next to "Other" is: Beto, Carla and Dani, never the 4 options chosen.
    expect(rows.map((r) => r.dimension)).not.toContain("valued");
    expect(
      rows
        .filter((r) => r.dimension === "best_work")
        .map((r) => [r.side, r.people]),
    ).toEqual([["self", "3"]]);
    const one = await table(
      "insights-sentiment.csv",
      `?locale=en&cycle=${c2}&relationship=self`,
    );
    expect(new Set(one.rows.map((r) => r.side))).toEqual(new Set(["self"]));
  });

  it("carries no text, quotes or names", async () => {
    const { text } = await download("insights-sentiment.csv", "?locale=en");
    expect(text).not.toMatch(/Exportad[ao]/);
    expect(text).not.toContain("documentación");
    expect(text).not.toContain("Norte");
  });
});

describe("insights-sentiment-by.csv: the reading per group", () => {
  it("says what the readers say per group, in people", async () => {
    for (const [groupBy, query, f] of [
      ["account", "", {}],
      ["department", `&cycle=${c2}`, { cycleId: c2 }],
      [
        "account",
        `&cycle=${c2}&department=Ventas`,
        { cycleId: c2, department: "Ventas" },
      ],
    ] as const) {
      const { header, rows } = await table(
        "insights-sentiment-by.csv",
        `?locale=en&groupBy=${groupBy}${query}`,
      );
      expect(header.slice(0, 3)).toEqual(["group", "people", "signal_any"]);
      const bySignal = await signalsByGroup(db, hr, f, groupBy);
      const byFeedback = await managerFeedbackByGroup(db, hr, f, groupBy);
      expect(rows.map((r) => r.group)).toEqual(
        bySignal.map((g) => g.label ?? ""),
      );
      for (const g of bySignal) {
        const r = rows.find((x) => x.group === (g.label ?? ""))!;
        expect(num(r.people)).toBe(g.people);
        expect(num(r.signal_any)).toBe(g.withAny);
        for (const s of signals)
          expect(num(r[`signal_${s}`])).toBe(g.counts[s]);
        const mf = byFeedback.find((x) => x.key === g.key);
        expect(num(r.manager_feedback_people)).toBe(mf?.people ?? 0);
        expect(num(r.manager_feedback_none)).toBe(mf?.none ?? 0);
        expect(num(r.manager_feedback_generic)).toBe(mf?.generic ?? 0);
        expect(num(r.manager_feedback_specific)).toBe(mf?.specific ?? 0);
      }
    }
  });

  it("counts distinct people: Cuenta A has one (Ana, two cycles), Cuenta B three", async () => {
    const { rows } = await table(
      "insights-sentiment-by.csv",
      "?locale=en&groupBy=account",
    );
    expect(rows.map((r) => [r.group, r.people])).toEqual([
      ["Cuenta A", "1"],
      ["Cuenta B", "3"],
    ]);
  });

  it("keeps the file name of the group and rejects a grouping that is not one", async () => {
    const { response } = await download(
      "insights-sentiment-by.csv",
      "?groupBy=dm",
    );
    expect(response.headers.get("content-disposition")).toContain(
      "insights-sentiment-by-dm.csv",
    );
    const bad = await download("insights-sentiment-by.csv", "?groupBy=person");
    expect(bad.status).toBe(400);
  });
});

describe("insights-yes-no.csv: the Sí / No rates, in people", () => {
  it("says what yesNoRates says per question and side", async () => {
    const { header, rows } = await table(
      "insights-yes-no.csv",
      `?locale=en&cycle=${c2}`,
    );
    expect(header).toEqual([
      "dimension",
      "question_prompt_es",
      "question_prompt_en",
      "side",
      "yes",
      "no",
      "people",
      "yes_pct",
      "no_pct",
    ]);
    const rates = await yesNoRates(db, hr, { cycleId: c2 });
    expect(rows.map((r) => `${r.dimension}|${r.side}`)).toEqual(
      rates.map((r) => `${r.dimension}|${r.side}`),
    );
    for (const rate of rates) {
      const r = rows.find(
        (x) => x.dimension === rate.dimension && x.side === rate.side,
      )!;
      expect(num(r.yes)).toBe(rate.yes);
      expect(num(r.no)).toBe(rate.no);
      expect(num(r.people)).toBe(rate.people);
      expect(num(r.no_pct)).toBeCloseTo((rate.no / rate.people) * 100, 1);
      expect(r.question_prompt_en).toBe(rate.prompt.en);
    }
    // Security (self): Dani yes, Ana yes, Beto and Carla no; talk (manager): Ana no.
    const security = rows.find((r) => r.dimension === "custom_security")!;
    expect([security.yes, security.no, security.people]).toEqual([
      "2",
      "2",
      "4",
    ]);
    expect(security.no_pct).toBe("50");
  });

  it("says what yesNoByGroup says per question and group", async () => {
    const { header, rows } = await table(
      "insights-yes-no.csv",
      `?locale=en&cycle=${c2}&groupBy=account`,
    );
    expect(header.slice(0, 2)).toEqual(["group", "dimension"]);
    expect(header).not.toContain("side");
    const groups = await yesNoByGroup(db, hr, { cycleId: c2 }, "account");
    expect(rows.map((r) => [r.group, r.dimension])).toEqual(
      groups.map((g) => [g.label ?? "", g.dimension]),
    );
    for (const g of groups) {
      const r = rows.find(
        (x) => x.group === (g.label ?? "") && x.dimension === g.dimension,
      )!;
      expect([num(r.yes), num(r.no), num(r.people)]).toEqual([
        g.yes,
        g.no,
        g.people,
      ]);
    }
    const { response } = await download(
      "insights-yes-no.csv",
      "?groupBy=account",
    );
    expect(response.headers.get("content-disposition")).toContain(
      "insights-yes-no-by-account.csv",
    );
  });
});

describe("insights-closed-questions.csv: valued as a scale, best work as options", () => {
  it("says what valuedDistribution and bestWorkOptions say, with the choice labels of the file's language", async () => {
    const { header, rows } = await table(
      "insights-closed-questions.csv",
      `?locale=es&cycle=${c2}`,
    );
    expect(header).toEqual([
      "sección",
      "grupo",
      "valor",
      "opción",
      "personas",
      "base (personas)",
      "personas (%)",
    ]);
    const valued = await valuedDistribution(db, hr, { cycleId: c2 });
    const best = await bestWorkOptions(db, hr, { cycleId: c2 });
    const section = (s: string) => rows.filter((r) => r["sección"] === s);
    expect(section("valued").map((r) => num(r.personas))).toEqual(
      valued.total!.counts,
    );
    expect(section("valued")[0]).toMatchObject({
      valor: "1",
      opción: "No me siento valorado",
      "base (personas)": String(valued.total!.people),
    });
    expect(section("not_valued").map((r) => num(r.personas))).toEqual([
      valued.total!.notValued,
    ]);
    expect(section("not_valued")[0]["personas (%)"]).toBe(
      one(
        Math.round((valued.total!.notValued / valued.total!.people) * 1000) /
          10,
      ),
    );
    expect(section("best_work").map((r) => [r.valor, num(r.personas)])).toEqual(
      best!.options.map((o) => [o.option, o.people]),
    );
    expect(section("best_work").find((r) => r.valor === "other")?.opción).toBe(
      "Otro",
    );
    expect(section("best_work")[0]["base (personas)"]).toBe(
      String(best!.people),
    );
    // Ana (valued 4, nothing), Beto, Carla, Dani (valued 1, other): 3 of 4 at 1-2.
    expect(valued.total!.notValued).toBe(3);
  });

  it("adds the valued scale per group when asked, as valuedDistribution does", async () => {
    const { rows } = await table(
      "insights-closed-questions.csv",
      `?locale=en&cycle=${c2}&groupBy=account`,
    );
    const valued = await valuedDistribution(db, hr, { cycleId: c2 }, "account");
    const perGroup = rows.filter(
      (r) => r.section === "valued" && r.group !== "",
    );
    expect(perGroup).toHaveLength(valued.byGroup.length * 4);
    for (const g of valued.byGroup) {
      const mine = perGroup.filter((r) => r.group === g.label);
      expect(mine.map((r) => num(r.people))).toEqual(g.counts);
    }
    expect(
      rows
        .filter((r) => r.section === "not_valued" && r.group === "Cuenta B")
        .map((r) => r.people),
    ).toEqual(["3"]);
  });
});

describe("the filters are validated", () => {
  it("rejects a side that is not self or manager and a sentiment that is not one", async () => {
    expect(
      (await download("insights-sentiment.csv", "?relationship=peer")).status,
    ).toBe(400);
    expect(
      (await download("insights-sentiment.csv", "?sentiment=angry")).status,
    ).toBe(400);
    expect(
      (await download("insights-sentiment.csv", "?cycle=nope")).status,
    ).toBe(400);
  });

  it("honors the page's dimension filter", async () => {
    const { rows } = await table(
      "insights-sentiment.csv",
      `?locale=en&cycle=${c2}&dimension=improvement`,
    );
    expect(new Set(rows.map((r) => r.dimension))).toEqual(
      new Set(["improvement"]),
    );
  });
});

describe("insights-self-assessment.csv: the reading of the self reviews, in people", () => {
  it("says what the report of the screen says: substance, valued, best work, agreement", async () => {
    const report = await selfAssessmentReport(db, hr, {
      cycleId: c2,
      groupBy: "department",
    });
    const { rows } = await table(
      "insights-self-assessment.csv",
      `?cycle=${c2}&locale=en`,
    );
    const of = (section: string) => rows.filter((r) => r.section === section);
    for (const s of report.substance) {
      for (const metric of ["none", "generic", "specific", "people"] as const) {
        expect(rows).toContainEqual({
          section: "substance",
          group: s.dimension,
          metric,
          value: String(s[metric]),
        });
      }
    }
    expect(of("valued").map((r) => [r.metric, Number(r.value)])).toEqual([
      ...report.valued!.counts.map((n, i) => [String(i + 1), n]),
      ["not_valued", report.valued!.notValued],
      ["n", report.valued!.people],
    ]);
    expect(
      of("best_work").map((r) => [r.group, r.metric, Number(r.value)]),
    ).toEqual([
      ...report.bestWork!.options.map((o) => [o.option, "people", o.people]),
      ["", "n", report.bestWork!.people],
    ]);
    expect(
      of("agreement").map((r) => [r.group, r.metric, Number(r.value)]),
    ).toEqual(
      report.agreement.rows.flatMap((a) => [
        [a.dimension, "both", a.both],
        [a.dimension, "shared", a.shared],
      ]),
    );
    expect(of("blind_spot").map((r) => [r.group, Number(r.value)])).toEqual(
      report.agreement.blindSpots.map((b) => [b.theme, b.people]),
    );
    // Four people at the latest cycle, a scale of 1-4 with 3 of them at 1-2.
    expect(report.valued!.people).toBe(4);
    expect(report.valued!.notValued).toBe(3);
    // No tone counted by answer any more.
    expect(
      rows.some((r) => ["sentiment", "sentiment_gap"].includes(r.section)),
    ).toBe(false);
  });
});
