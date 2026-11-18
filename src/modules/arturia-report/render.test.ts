import { describe, expect, it } from "vitest";
import { renderHtml, renderJson, svgBars, svgStacked } from "./render";
import { arturiaReportV1 } from "./schema";
import { sampleReport } from "./test-support";

/** Any http(s) URL, and src/href/url() that are not "#..." anchors or data: URIs. */
const EXTERNAL =
  /https?:\/\/|(?:src|href)\s*=\s*["']?(?!#|data:)[^"'\s>]|url\(\s*["']?(?!#|data:)/i;

describe("renderers", () => {
  const report = sampleReport();

  it("the sample is valid against the schema and JSON round-trips", () => {
    expect(arturiaReportV1.safeParse(report).success).toBe(true);
    expect(arturiaReportV1.parse(JSON.parse(renderJson(report)))).toEqual(
      report,
    );
  });

  it("rejects an anonymized report with people rows", () => {
    const bad = sampleReport();
    bad.sections.people = [];
    expect(arturiaReportV1.safeParse(bad).success).toBe(false);
  });

  it("renders a self-contained page: no external URL, the data embedded", () => {
    const html = renderHtml(report);
    expect(html).not.toMatch(EXTERNAL);
    expect(html).not.toMatch(/<link\b|<img\b|<iframe\b/i);
    const m = html.match(
      /<script type="application\/json" id="report">([\s\S]*?)<\/script>/,
    );
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual(report);
    // one closing script tag per script element: user text cannot break out
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  it("has every section, the toggle and es labels", () => {
    const html = renderHtml(report);
    for (const id of [
      "executive",
      "completion",
      "indicators",
      "qualitative",
      "goals",
    ]) {
      expect(html).toContain(`<section id="${id}"`);
    }
    expect(html).toContain('data-kind="qualitative"');
    expect(html).toContain('data-show="quantitative"');
    expect(html).toContain("Resumen ejecutivo");
    expect(html).not.toContain("No disponible");
    expect(html).toContain("<svg");
    expect(html).not.toContain('id="people"');
  });

  it("a section that is not available says so", () => {
    const r = sampleReport();
    r.sections.completion = null;
    r.sections.goals = null;
    const html = renderHtml(r);
    expect(html.match(/No disponible/g)).toHaveLength(2);
    expect(html).toContain('<section id="goals"');
  });

  it("renders in English with the en labels", () => {
    const html = renderHtml(sampleReport({ locale: "en" }));
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Executive summary");
  });

  describe("qualitative section", () => {
    const qualitative = (html: string) =>
      html.match(/<section id="qualitative"[\s\S]*?<\/section>/)![0];

    it("draws the five sentiments with their legend, and the same cut by side", () => {
      const html = qualitative(renderHtml(sampleReport()));
      for (const name of [
        "Positivo",
        "Constructivo",
        "Neutral",
        "Mixto",
        "Negativo",
      ]) {
        expect(html).toContain(name);
      }
      // one stacked chart for everybody and one for each side
      expect(html).toContain("Comentarios propios");
      expect(html).toContain("Comentarios del manager");
      expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(4);
      // five segments per dimension bar carry their own class
      for (const k of [0, 1, 2, 3, 4]) expect(html).toContain(`class="s${k}"`);
      // each theme tells its sentiment
      expect(html).toMatch(/comunicacion[\s\S]*Mixto 1/);
    });

    it("in English too, and an old report (three sentiments, no sides) still renders", () => {
      const en = qualitative(renderHtml(sampleReport({ locale: "en" })));
      expect(en).toContain("Mixed");
      expect(en).toContain("Own comments");
      const old = sampleReport();
      delete old.sections.qualitative!.bySide;
      delete old.sections.qualitative!.totals;
      expect(qualitative(renderHtml(old))).not.toContain("Comentarios propios");
    });

    it("the schema reads a minor-1 report: missing neutral and mixed are zero", () => {
      const r = sampleReport();
      const json = JSON.parse(renderJson(r));
      for (const row of json.sections.qualitative.sentimentByDimension) {
        delete row.neutral;
        delete row.mixed;
      }
      const parsed = arturiaReportV1.parse(json);
      expect(
        parsed.sections.qualitative?.sentimentByDimension[0],
      ).toMatchObject({ neutral: 0, mixed: 0 });
    });
  });

  describe("goals section", () => {
    const goals = (html: string) =>
      html.match(/<section id="goals"[\s\S]*?<\/section>/)![0];

    it("draws the KPIs as SVG bars, the buckets as a table and counts the outliers", () => {
      const html = goals(renderHtml(sampleReport()));
      // by area and by team: one stacked bar per group, labelled with its n
      expect(html.match(/<svg/g)).toHaveLength(2);
      expect(html).toContain("Ingeniería (n=7)");
      expect(html).toContain("Equipo 1 (n=6)");
      // tiles
      expect(html).toContain("<b>10</b><span>Personas con objetivos</span>");
      expect(html).toContain("<b>38%</b><span>Completados</span>");
      expect(html).toContain("<b>62%</b><span>Avance promedio</span>");
      // goals by status: completed 6, in progress on time 6, overdue 2, closed 1
      expect(html).toMatch(/<title>[^<]* · Vencidos: 2 \(\d+%\)<\/title>/);
      expect(html).toMatch(/<title>[^<]* · En curso: 6 \(\d+%\)<\/title>/);
      // wide segments carry their percent inside
      expect(html).toMatch(/class="in">\d+%<\/text>/);
      expect(html).toContain("Vencidos</span>");
      // buckets table: a hidden bucket shows dashes and a note
      expect(html).toContain(
        "<td>0–50%</td><td>6</td><td>3.50</td><td>3.25</td><td>40%</td>",
      );
      expect(html).toContain(
        "<td>50–100%</td><td>–</td><td>–</td><td>–</td><td>–</td>",
      );
      expect(html).toContain("Menos personas que el grupo mínimo");
      expect(html).toContain(
        "Personas fuera del desglose (grupos menores al mínimo): 4",
      );
      // outliers: counts only, the hidden one as a dash
      expect(html).toContain(
        "Objetivos cumplidos con retención o compromiso bajo: <b>5</b>",
      );
      expect(html).toContain(
        "Objetivos atrasados con retención y compromiso altos: <b>–</b>",
      );
      expect(html).not.toContain("<th>Nombre</th>");
    });

    it("hides the totals when the report says they would give a group away", () => {
      const r = sampleReport();
      r.sections.goals!.participantsWithGoals = null;
      r.sections.goals!.goals = null;
      r.sections.goals!.completed = null;
      r.sections.goals!.avgProgress = null;
      const html = goals(renderHtml(r));
      expect(html).toContain("Total oculto");
      expect(html).not.toContain("Personas con objetivos");
    });

    it("lists the outliers by name (escaped) in the named report only", () => {
      const r = sampleReport({ anonymized: false, minGroupSize: 5 });
      r.sections.people = [];
      r.sections.goals!.withoutGoals = 3;
      r.sections.goals!.outliers.doneButLow = {
        count: 1,
        people: [
          {
            personId: "p1",
            name: "Ana <b>Prueba</b>",
            department: "Ingeniería",
            manager: null,
            goals: 4,
            completed: 4,
            completedPct: 100,
            retention: 2,
            engagement: null,
          },
        ],
      };
      expect(arturiaReportV1.safeParse(r).success).toBe(true);
      const html = goals(renderHtml(r));
      expect(html).toContain("Ana &lt;b&gt;Prueba&lt;/b&gt;");
      expect(html).not.toContain("<b>Prueba</b>");
      expect(html).toContain("<td>4/4</td><td>100%</td><td>2</td><td>–</td>");
      expect(html).toContain("<b>3</b><span>Personas sin objetivos</span>");
    });

    it("an anonymized report may not name the outliers", () => {
      const r = sampleReport();
      r.sections.goals!.outliers.doneButLow.people = [
        {
          personId: "p1",
          name: "Ana",
          department: null,
          manager: null,
          goals: 1,
          completed: 1,
          completedPct: 100,
          retention: 1,
          engagement: 1,
        },
      ];
      expect(arturiaReportV1.safeParse(r).success).toBe(false);
    });

    it("speaks English with the en labels", () => {
      const html = goals(renderHtml(sampleReport({ locale: "en" })));
      expect(html).toContain("Goals completed vs indicators");
      expect(html).toContain("Outliers");
      expect(html).toContain("Fewer people than the minimum group");
    });
  });

  it("completion: the totals, the sides by group and the change against the previous cycle", () => {
    const html = renderHtml(sampleReport()).match(
      /<section id="completion"[\s\S]*?<\/section>/,
    )![0];
    expect(html).toContain(
      "<td>Autoevaluación</td><td>12</td><td>9</td><td>3</td><td>75%</td>",
    );
    expect(html).toContain("Ingeniería · Autoevaluación");
    // a side that applies to nobody stays, marked, so the groups match the totals
    expect(html).toContain("Equipo 1 · Autoevaluación (No aplica)");
    expect(html).toContain("Equipo 1 · Manager");
    expect(html).toContain(
      "Cambio contra el ciclo anterior (Evaluación 2024, puntos porcentuales)",
    );
    expect(html).toContain("<td>Total</td><td>+5.5</td><td>-2</td>");
    expect(html).toContain("<td>Ingeniería</td><td>0</td><td>–</td>");
  });

  it("completion: a total side that applies to nobody says so instead of 0 %", () => {
    const r = sampleReport();
    r.sections.completion!.byRelationship![1] = {
      relationship: "manager",
      total: 0,
      submitted: 0,
      applicable: false,
      draft: null,
      declined: null,
    };
    const html = renderHtml(r).match(
      /<section id="completion"[\s\S]*?<\/section>/,
    )![0];
    expect(html).toContain(
      "<td>Manager</td><td>0</td><td>0</td><td>0</td><td>No aplica</td>",
    );
  });

  it("completion: a hidden total and a hidden change of the total show a note", () => {
    const r = sampleReport();
    r.sections.completion!.byRelationship = null;
    r.sections.completion!.delta!.total = null;
    const html = renderHtml(r).match(
      /<section id="completion"[\s\S]*?<\/section>/,
    )![0];
    expect(html.match(/Total oculto/g)).toHaveLength(2);
    expect(html).not.toContain("<td>Total</td>");
  });

  it("shows a note instead of totals hidden to avoid differencing", () => {
    const r = sampleReport();
    r.sections.executive.distribution = null;
    expect(renderHtml(r)).toContain("Total oculto");
  });

  it("the toggle shows and hides sections", () => {
    document.documentElement.innerHTML = renderHtml(report)
      .replace(/^<!doctype html>\s*<html[^>]*>/i, "")
      .replace(/<\/html>\s*$/, "");
    const script = [...document.querySelectorAll("script")].find(
      (s) => !s.type,
    )!;
    new Function(script.textContent ?? "")();
    const btn = (k: string) =>
      document.querySelector<HTMLButtonElement>(`button[data-show="${k}"]`)!;
    const hidden = (id: string) =>
      document.getElementById(id)!.hasAttribute("hidden");
    btn("qualitative").click();
    expect(hidden("executive")).toBe(true);
    expect(hidden("qualitative")).toBe(false);
    btn("quantitative").click();
    expect(hidden("executive")).toBe(false);
    expect(hidden("qualitative")).toBe(true);
    btn("all").click();
    expect(hidden("qualitative")).toBe(false);
  });
});

describe("SVG labels", () => {
  const long = `${"Dirección de Corporativo y Tecnología ".repeat(2)}.`.slice(
    0,
    60,
  );
  const text = (svg: string) =>
    [...svg.matchAll(/<text [^>]*>([^<]*)/g)].map((m) => m[1]);

  it("a label of 60 characters is cut at 40 with an ellipsis, the whole text in a title", () => {
    expect(long).toHaveLength(60);
    for (const svg of [
      svgBars([{ label: long, value: 3 }]),
      svgStacked([{ label: long, parts: [1, 2] }], ["a", "b"]),
    ]) {
      const [shown] = text(svg);
      expect(shown).toHaveLength(40);
      expect(shown.endsWith("…")).toBe(true);
      expect(shown).toBe(`${long.slice(0, 39)}…`);
      expect(svg).toContain(`<title>${long}</title>`);
      // the bars start after the room the cut label needs (40 x 6.3 + 16)
      expect(svg).toMatch(/<rect x="268(\.0)?"/);
    }
  });

  it("a label up to 40 characters is drawn whole, without a title of its own", () => {
    const label = "x".repeat(40);
    const svg = svgBars([{ label, value: 1 }]);
    expect(text(svg)[0]).toBe(label);
    expect(svg).not.toContain("<title>");
  });

  it("escapes the full text of the title", () => {
    const label = `<b>"${"y".repeat(60)}"</b>`;
    const svg = svgBars([{ label, value: 1 }]);
    expect(svg).toContain("<title>&lt;b&gt;&quot;");
    expect(svg).not.toContain("<b>");
  });

  it("short labels keep the minimum room", () => {
    expect(svgBars([{ label: "Ventas", value: 1 }])).toMatch(/<rect x="180"/);
  });
});

describe("monthly engagement (schema minor 4)", () => {
  const month = (m: string, over = {}) => ({
    month: m,
    hidden: false,
    people: 20,
    respondents: 16,
    participation: 0.8,
    meanScore: 0.64,
    segments: { alto: 5, medio: 6, regular: 3, bajo: 2, falta: 4 },
    ...over,
  });

  it("a report of an earlier minor, without the section, is valid and renders without it", () => {
    const old = sampleReport();
    expect(arturiaReportV1.safeParse(old).success).toBe(true);
    expect(renderHtml(old)).not.toContain('id="engagement-monthly"');
  });

  it("a null section (no data in the period) says it is not available", () => {
    const r = sampleReport({
      schemaMinor: 4,
      sections: { ...sampleReport().sections, engagementMonthly: null },
    });
    expect(arturiaReportV1.safeParse(r).success).toBe(true);
    expect(renderHtml(r)).toMatch(
      /id="engagement-monthly"[^]*?No disponible en esta versión/,
    );
  });

  it("renders the months with their segments, and says which are under the minimum", () => {
    const r = sampleReport({
      schemaMinor: 4,
      sections: {
        ...sampleReport().sections,
        engagementMonthly: {
          suppressedMonths: 1,
          months: [
            month("2026-01"),
            month("2026-02", { meanScore: 0.7 }),
            month("2026-03", {
              hidden: true,
              people: null,
              respondents: null,
              participation: null,
              meanScore: null,
              segments: null,
            }),
          ],
        },
      },
    });
    expect(arturiaReportV1.safeParse(r).success).toBe(true);

    const html = renderHtml(r);

    expect(html).toContain("Engagement mensual");
    expect(html).toContain("2026-01");
    expect(html).toContain("0.64");
    expect(html).toContain("80%");
    expect(html).toContain("Menos que el grupo mínimo");
    expect(html).toContain("Falta");
    expect(renderHtml({ ...r, locale: "en" })).toContain("Monthly engagement");
  });

  it("rejects a score or a share out of 0-1", () => {
    const base = sampleReport().sections;
    const bad = (e: object) =>
      arturiaReportV1.safeParse(
        sampleReport({
          sections: {
            ...base,
            engagementMonthly: {
              suppressedMonths: 0,
              months: [month("2026-01", e)],
            },
          },
        }),
      ).success;
    expect(bad({})).toBe(true);
    expect(bad({ meanScore: 1.2 })).toBe(false);
    expect(bad({ participation: -0.1 })).toBe(false);
    expect(bad({ month: "enero" })).toBe(false);
  });
});

describe("org cuts (schema minor 3)", () => {
  it("a report of minor 2, without them, is still valid and renders without their sections", () => {
    const old = sampleReport();
    expect(old.schemaMinor).toBe(2);
    expect(arturiaReportV1.safeParse(old).success).toBe(true);
    const html = renderHtml(old);
    expect(html).not.toContain("Por cuenta");
    expect(html).not.toContain("Por DM");
  });

  it("renders the cuts by account and by DM in completion, indicators and goals", () => {
    const r = sampleReport({ schemaMinor: 3 });
    const completion = r.sections.completion!;
    const row = (label: string) => ({
      label,
      relationship: "self",
      n: 6,
      total: 6,
      submitted: 4,
      applicable: true,
      other: false,
    });
    completion.byAccount = [row("Cuenta A")];
    completion.byDm = [row("DM 1")];
    completion.suppressed = { ...completion.suppressed, byAccount: 0, byDm: 2 };
    const distribution = r.sections.indicators!.distribution[0];
    const group = {
      label: "DM 1",
      n: 6,
      mean: 3,
      counts: [0, 1, 4, 1, 0],
      other: false,
    };
    distribution.byDm = [group];
    distribution.byAccount = [{ ...group, label: "Cuenta A" }];
    distribution.suppressedBy = { account: 0, dm: 0 };
    expect(arturiaReportV1.safeParse(r).success).toBe(true);

    const html = renderHtml(r);

    expect(html).toContain("Por cuenta");
    expect(html).toContain("Por DM");
    expect(html).toContain("Cuenta A");
    expect(html).toContain("DM 1");
    // The people left out of the DM cut are said.
    expect(html).toContain("2");
    const en = renderHtml({ ...r, locale: "en" });
    expect(en).toContain("By account");
    expect(en).toContain("By DM");
  });
});
