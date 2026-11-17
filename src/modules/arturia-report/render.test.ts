import { describe, expect, it } from "vitest";
import { renderHtml, renderJson } from "./render";
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
    expect(html).toContain(
      "Cambio contra el ciclo anterior (Evaluación 2024, puntos porcentuales)",
    );
    expect(html).toContain("<td>Total</td><td>+5.5</td><td>-2</td>");
    expect(html).toContain("<td>Ingeniería</td><td>0</td><td>–</td>");
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
