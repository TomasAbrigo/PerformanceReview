import { describe, expect, it } from "vitest";
import {
  labelsFor,
  readingNames,
  signalLabel,
  substanceLabel,
  themeLabel,
} from "./labels";
import {
  renderHtml,
  renderJson,
  shortCycleNames,
  svgBars,
  svgStacked,
} from "./render";
import { arturiaReportV1 } from "./schema";
import {
  CONVERSATIONS,
  ENVIRONMENTAL,
  SECURITY,
  SOCIAL,
  sampleReport,
} from "./test-support";

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

  describe("qualitative section (the open-text reading, #129)", () => {
    const qualitative = (html: string) =>
      html.match(/<section id="qualitative"[\s\S]*?<\/section>/)![0];
    const section = (locale: "es" | "en" = "es") =>
      qualitative(renderHtml(sampleReport({ locale })));

    it("says where the labels come from, and that the mock is a demo", () => {
      const html = section();
      expect(html).toContain("Procedencia de la lectura");
      expect(html).toContain("Lectura de demostración");
      expect(html).toContain("Leído por mock");
      expect(html).toContain("2026-11-18");
      expect(html).toContain("10% corregidas por personas (4)");
      expect(html).toContain('data-demo="1"');
      expect(section("en")).toContain("Demo reading");
      // a real provider is not called a demo
      const real = sampleReport();
      real.sections.qualitative!.provenance.demo = false;
      real.sections.qualitative!.provenance.providers = [
        { provider: "anthropic", model: "claude-x", labels: 36 },
      ];
      const html2 = qualitative(renderHtml(real));
      expect(html2).not.toContain("Lectura de demostración");
      expect(html2).toContain("anthropic (claude-x)");
    });

    it.each(["es", "en"] as const)(
      "no raw key reaches the HTML (%s): questions, themes, signals and substance are named",
      (locale) => {
        const T = readingNames(locale);
        // the question names come in the report's language, as the build writes them
        const r = sampleReport({ locale });
        const q4 = [SECURITY, SOCIAL, ENVIRONMENTAL, CONVERSATIONS];
        const names = [
          T.questions.security,
          T.questions.social,
          T.questions.environmental,
          T.questions.conversations,
        ];
        r.sections.qualitative!.questions =
          r.sections.qualitative!.questions.map((x) =>
            q4.includes(x.dimension)
              ? { ...x, label: names[q4.indexOf(x.dimension)] }
              : x,
          );
        const html = qualitative(renderHtml(r));
        // dimension, theme and signal keys, and the imports' question slugs
        expect(html).not.toMatch(
          /custom_|best_work|company_request|role_fit|\bcomunicacion\b|\bplanificacion\b|\bproactividad\b|\bvoluntariado\b|\bworkload\b/,
        );
        for (const name of Object.values(T.questions)) {
          expect(html).toContain(name);
        }
        expect(html).toContain(themeLabel("comunicacion", locale));
        expect(html).toContain(signalLabel("workload", locale));
        expect(html).toContain(substanceLabel("specific", locale));
      },
    );

    it("tells the two custom (impact) questions apart, and names the four yes/no ones", () => {
      const html = section();
      for (const name of [
        "Seguridad de la información",
        "Impacto social",
        "Impacto ambiental",
        "Conversaciones frecuentes",
      ]) {
        expect(html).toContain(name);
      }
      const rows = html.match(/<tr><td>Impacto (social|ambiental)<\/td>/g);
      expect(rows).toHaveLength(2);
    });

    it("an unpublished figure reads –, never 0", () => {
      const html = section();
      // Ingeniería: attrition (null) between workload 3 and conflict 0
      expect(html).toMatch(
        /<tr><td>Ingeniería<\/td><td>9<\/td><td>4<\/td><td>3<\/td><td>–<\/td><td>0<\/td>/,
      );
      // the manager's themes side: not published, in the header and the cells
      expect(html).toContain("Manager (n = –)");
      // a yes/no question with its figures hidden does not alert
      expect(html).toContain("Seguridad de la información: 3 de 12");
      expect(html).not.toContain("Conversaciones frecuentes: en");
      // a row with a hidden cell goes to the table, not to a bar of lies
      expect(html).toMatch(/<td>Otros<\/td><td>6<\/td><td>–<\/td>/);
    });

    it("draws the substance, the closed scale and the tone as stacked bars", () => {
      const html = section();
      expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(5);
      for (const name of ["Positivo", "Constructivo", "Mixto", "Negativo"]) {
        expect(html).toContain(name);
      }
      expect(html).toContain("Tono (secundario)");
      expect(html).toContain("Preguntas cerradas");
      expect(html).toContain("No se sienten valoradas (1–2): <b>4 (33%)</b>");
    });

    it("quotes are text, never markup; a report without quotes has no list of them", () => {
      const html = section();
      expect(html).toContain('class="quotes"');
      expect(html).not.toContain("</script> http://x.example");
      expect(html).not.toMatch(EXTERNAL);
      const none = sampleReport();
      for (const t of none.sections.qualitative!.themes) {
        for (const r of t.rows) r.quotes = { self: [], manager: [] };
      }
      expect(qualitative(renderHtml(none))).not.toContain('class="quotes"');
    });

    it("crosses the signals with the manager's retention and engagement answer, by value", () => {
      const html = section();
      expect(html).toContain("Señales según la respuesta del manager");
      // each indicator in its own table, the value with its label
      expect(html).toContain("<h4>Retención</h4>");
      expect(html).toContain("<h4>Compromiso</h4>");
      expect(html).toContain("5 · Haría todo para retenerlo");
      expect(html).toMatch(
        /<td>5 · Haría todo para retenerlo<\/td><td>6<\/td><td>1 \(17%\)<\/td>/,
      );
      // an unpublished figure reads –, a value without label is its number
      expect(html).toMatch(/<td>2<\/td><td>6<\/td><td>–<\/td>/);
      expect(section("en")).toContain("Signals by the manager&#39;s answer");
    });

    it("Yes / No by group and by cycle: a group with no figure is counted, the cycles come oldest first", () => {
      const html = section();
      expect(html).toContain("Sí y No por grupo");
      expect(html).toMatch(
        /<tr><td>Por área<\/td><td>Ingeniería<\/td><td>9<\/td><td>7 \(78%\)<\/td><td>2 \(22%\)<\/td><\/tr>/,
      );
      // "Otros" has neither figure: not listed, said once
      expect(html).not.toMatch(/<td>Por área<\/td><td>Otros<\/td>/);
      expect(html).toContain("1 grupo sin cifras publicadas");
      // by cycle: the No out of the people, the hidden one reads "–"
      expect(html).toContain("Sí y No por ciclo");
      const order = ["2025-H1", "2025-H2", "2026-H1"].map((c) =>
        html.indexOf(`<td>${c}</td>`),
      );
      expect(order.every((i) => i > 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(html).toContain("No 2 / 10 (20%)");
      expect(html).toContain("– / 12");
    });

    it("the valued scale by group and by cycle: bars, and a table for the rows with a hidden cell", () => {
      const html = section();
      expect(html).toContain("Valoración por grupo · Por área");
      expect(html).toContain("Valoración por ciclo");
      // Ingeniería has all four cells: a bar; Otros has hidden ones: the table
      expect(html).toContain("Ingeniería · 4 · Me siento valorado: 2 (25%)");
      expect(html).toMatch(
        /<td>Otros<\/td><td>4<\/td><td>1<\/td><td>2<\/td><td>–<\/td><td>–<\/td>/,
      );
      // both cycles drawn, with the names a clipped label still tells apart
      expect(html).toContain("2025-H2 · 4 · Me siento valorado");
      expect(html).toContain("2026-H1 · 4 · Me siento valorado");
    });

    it("the section without signals or valued says so instead of failing", () => {
      const r = sampleReport();
      r.sections.qualitative!.signals = null;
      r.sections.qualitative!.closed = { valued: null, bestWork: null };
      const html = qualitative(renderHtml(r));
      expect(html).toContain("Ninguna señal");
    });

    it("is null-safe: a missing section reads as not available", () => {
      const r = sampleReport();
      r.sections.qualitative = null;
      expect(qualitative(renderHtml(r))).toContain("No disponible");
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

    it("says the date overdue is measured at, and draws the states as a partition", () => {
      const r = sampleReport();
      r.sections.goals!.asOf = "2025-12-31";
      const html = goals(renderHtml(r));
      expect(html).toContain("Fecha de corte de los vencidos: 2025-12-31");
      // Ingeniería: 6 completed + 6 in progress + 2 overdue + 1 closed = 15.
      expect(html).toMatch(
        /<title>Ingeniería \(n=7\) · En curso: 6 \(40%\)<\/title>/,
      );
      expect(html).toMatch(
        /<title>Ingeniería \(n=7\) · Vencidos: 2 \(13%\)<\/title>/,
      );
      // A report of an earlier minor has no date: nothing is said of it.
      delete r.sections.goals!.asOf;
      expect(goals(renderHtml(r))).not.toContain("Fecha de corte");
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

  it("a cycle without ratings says no data instead of drawing a row of zeros", () => {
    const r = sampleReport();
    r.sections.executive.distribution = null;
    r.sections.executive.distributionStatus = "no_data";
    r.sections.executive.byDepartment = [];
    expect(arturiaReportV1.safeParse(r).success).toBe(true);
    const html = renderHtml(r).match(
      /<section id="executive"[\s\S]*?<\/section>/,
    )![0];
    expect(html).toContain(
      "Sin datos: el ciclo no tiene calificaciones finales",
    );
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("Total oculto");
    // Under the minimum is another thing: it says the total is hidden.
    r.sections.executive.distributionStatus = "suppressed";
    expect(renderHtml(r)).toContain("Total oculto");
  });

  it("says the progress of the sides in words, and the people's statuses too", () => {
    const r = sampleReport({ anonymized: false });
    r.sections.people = [
      {
        personId: "p1",
        displayName: "Ana",
        email: null,
        department: null,
        manager: null,
        selfStatus: "in_progress",
        managerStatus: "not_applicable",
        retention: null,
        engagement: null,
        positiveShare: null,
        comments: 0,
      },
    ];
    const people = renderHtml(r).match(
      /<section id="people"[\s\S]*?<\/section>/,
    )![0];
    expect(people).toContain("<td>En curso</td><td>No aplica</td>");
    // The English report has its own words.
    expect(renderHtml(r, labelsFor("en"))).toContain(
      "<td>In progress</td><td>Does not apply</td>",
    );
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
    const old = sampleReport({ schemaMinor: 2 });
    expect(arturiaReportV1.safeParse(old).success).toBe(true);
    // (the qualitative section has its own cuts since minor 6: not under test here)
    const html = renderHtml(old).replace(
      /<section id="qualitative"[\s\S]*?<\/section>/,
      "",
    );
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

describe("shortCycleNames", () => {
  it("drops what the names share up to a word, and keeps a single name whole", () => {
    expect(
      shortCycleNames([
        "Evaluación semestral 2024-04-15 – 2024-09-28",
        "Evaluación semestral 2024-09-29 – 2025-03-28",
      ]),
    ).toEqual(["2024-04-15 – 2024-09-28", "2024-09-29 – 2025-03-28"]);
    expect(shortCycleNames(["Evaluación 2025"])).toEqual(["Evaluación 2025"]);
    // nothing in common: nothing dropped; identical names stay whole
    expect(shortCycleNames(["2025-H1", "2025-H2"])).toEqual([
      "2025-H1",
      "2025-H2",
    ]);
    expect(shortCycleNames(["A b", "A b"])).toEqual(["A b", "A b"]);
  });
});
