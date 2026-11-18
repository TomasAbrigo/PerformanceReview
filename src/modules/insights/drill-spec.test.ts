import { describe, expect, it } from "vitest";
import {
  type Drill,
  formatDrill,
  maskBreakdown,
  parseDrill,
} from "./drill-spec";

describe("parseDrill / formatDrill", () => {
  const valid: Drill[] = [
    { kind: "indicator", indicator: "retention", value: 2 },
    { kind: "indicator", indicator: "engagement", value: null },
    { kind: "risk", retention: "low", engagement: "high" },
    { kind: "theme", theme: "comunicacion" },
    { kind: "sentiment", dimension: "strengths", sentiment: "negative" },
    { kind: "completion", side: "manager", state: "pending" },
    { kind: "goals", state: "overdue" },
  ];
  it.each(valid)("round-trips %o", (d) => {
    expect(parseDrill(formatDrill(d))).toEqual(d);
  });
  it.each([
    undefined,
    ["indicator:retention:2"],
    "",
    "indicator:retention:6",
    "indicator:retention:2.5",
    "indicator:mood:2",
    "risk:low",
    "risk:low:none",
    "theme:",
    "theme:a b",
    "theme:x:y",
    "sentiment:strengths:angry",
    "completion:peer:pending",
    "goals:late",
    "nope:1",
  ])("rejects %o", (raw) => {
    expect(parseDrill(raw)).toBeNull();
  });
});

describe("maskBreakdown", () => {
  const keys = (spec: Record<string, number>) =>
    Object.entries(spec).flatMap(([k, n]) => Array<string>(n).fill(k));

  it("People: every group, largest first, and the total", () => {
    expect(maskBreakdown(keys({ A: 1, B: 3 }), null)).toEqual({
      total: 4,
      groups: [
        { key: "B", others: false, n: 3 },
        { key: "A", others: false, n: 1 },
      ],
    });
  });
  it("direction: nothing under the minimum", () => {
    expect(maskBreakdown(keys({ A: 2, B: 2 }), 5)).toEqual({
      total: null,
      groups: [],
    });
  });
  it("direction: small groups folded into others when that reaches the minimum", () => {
    expect(maskBreakdown(keys({ A: 6, B: 3, C: 2 }), 5)).toEqual({
      total: 11,
      groups: [
        { key: "A", others: false, n: 6 },
        { key: null, others: true, n: 5 },
      ],
    });
  });
  it("direction: a small leftover is hidden and so is the total", () => {
    expect(maskBreakdown(keys({ A: 6, B: 2 }), 5)).toEqual({
      total: null,
      groups: [{ key: "A", others: false, n: 6 }],
    });
  });
});

// ---- quant (#117): group- and month-scoped drills ----
describe("parseDrill / formatDrill: group and month drills", () => {
  const valid: Drill[] = [
    {
      kind: "completionGroup",
      side: "self",
      state: "pending",
      groupBy: "department",
      key: "Ingeniería: plataforma",
    },
    {
      kind: "completionGroup",
      side: "manager",
      state: "submitted",
      groupBy: "manager",
      key: null,
    },
    {
      kind: "indicatorGroup",
      indicator: "retention",
      value: 2,
      groupBy: "account",
      key: "Acme / Retail",
    },
    {
      kind: "indicatorGroup",
      indicator: "engagement",
      value: null,
      groupBy: "department",
      key: "Producto",
    },
    { kind: "engagement", month: "2026-03-01", segment: null },
    { kind: "engagement", month: "2026-03-01", segment: "bajo" },
  ];
  it.each(valid)("round-trips %o", (d) => {
    expect(parseDrill(formatDrill(d))).toEqual(d);
  });
  it.each([
    "cgroup:self:pending:none:x",
    "cgroup:self:late:department:x",
    "cgroup:self:pending:department:%E0%A4%A",
    "igroup:retention:7:department:x",
    "igroup:mood:all:department:x",
    "engagement:2026-13-01",
    "engagement:2026-03-01:angry",
    "engagement:march",
  ])("rejects %o", (raw) => {
    expect(parseDrill(raw)).toBeNull();
  });
});
