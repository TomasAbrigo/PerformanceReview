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
    expect(html).toContain("No disponible");
    expect(html).toContain("<svg");
    expect(html).not.toContain('id="people"');
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
