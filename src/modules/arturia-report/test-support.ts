import type { ArturiaReport } from "./schema";

/** A small valid report (unit tests of the renderers). */
export function sampleReport(over: Partial<ArturiaReport> = {}): ArturiaReport {
  return {
    schemaVersion: "arturia-report.v1",
    schemaMinor: 0,
    generatedAt: "2026-11-17T12:00:00.000Z",
    cycle: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Evaluación 2025",
      periodStart: "2025-01-01",
      periodEnd: "2025-12-31",
    },
    anonymized: true,
    minGroupSize: 5,
    sections: {
      executive: {
        participants: 12,
        progress: [{ relationship: "self", total: 12, submitted: 9 }],
        bins: [
          { from: 0, to: 0.5 },
          { from: 0.5, to: 1 },
        ],
        distribution: [4, 8],
        byDepartment: [
          {
            label: "Ingeniería",
            n: 7,
            mean: 0.6,
            counts: [2, 5],
            other: false,
          },
          { label: "Otros", n: 5, mean: 0.5, counts: [2, 3], other: true },
        ],
        suppressed: 0,
      },
      completion: null,
      indicators: {
        distribution: [
          {
            indicator: "retention",
            groups: [
              {
                label: "Equipo 1",
                n: 6,
                mean: 3.5,
                counts: [0, 1, 2, 2, 1],
                other: false,
              },
            ],
            total: null,
            suppressed: 0,
          },
        ],
        riskMatrix: {
          cells: [
            { retention: "low", engagement: "low", count: 2, risk: true },
          ],
          total: 6,
          riskCount: 2,
        },
        alerts: [{ kind: "drop", indicator: "retention", count: 1 }],
      },
      qualitative: {
        sentimentByDimension: [
          {
            dimension: "strengths",
            positive: 5,
            constructive: 1,
            negative: 0,
            total: 6,
            other: false,
          },
        ],
        trend: [
          {
            cycleId: "a",
            cycleName: "2024",
            periodEnd: "2024-12-31",
            positive: 2,
            constructive: 1,
            negative: 1,
            total: 4,
          },
          {
            cycleId: "b",
            cycleName: "2025",
            periodEnd: "2025-12-31",
            positive: 5,
            constructive: 1,
            negative: 0,
            total: 6,
          },
        ],
        topThemes: [
          {
            theme: "comunicacion",
            count: 4,
            other: false,
            quotes: ["[P1] comunica bien </script> http://x.example"],
          },
        ],
        suppressed: 0,
      },
      goals: null,
      people: null,
    },
    ...over,
  };
}
