import type { ArturiaReport } from "./schema";

/** A small valid report (unit tests of the renderers). */
export function sampleReport(over: Partial<ArturiaReport> = {}): ArturiaReport {
  return {
    schemaVersion: "arturia-report.v1",
    schemaMinor: 1,
    generatedAt: "2026-11-17T12:00:00.000Z",
    locale: "es",
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
      completion: {
        participants: 12,
        byRelationship: [
          {
            relationship: "self",
            total: 12,
            submitted: 9,
            draft: null,
            declined: null,
          },
          {
            relationship: "manager",
            total: 11,
            submitted: 6,
            draft: null,
            declined: null,
          },
        ],
        byDepartment: [
          {
            label: "Ingeniería",
            relationship: "self",
            n: 7,
            total: 7,
            submitted: 6,
            other: false,
          },
          {
            label: "Otros",
            relationship: "self",
            n: 5,
            total: 5,
            submitted: 3,
            other: true,
          },
        ],
        byManager: [
          {
            label: "Equipo 1",
            relationship: "manager",
            n: 6,
            total: 6,
            submitted: 4,
            other: false,
          },
        ],
        suppressed: { byDepartment: 0, byManager: 0 },
        delta: {
          previousCycleName: "Evaluación 2024",
          total: { self: 5.5, manager: -2 },
          byDepartment: [
            { label: "Ingeniería", other: false, self: 0, manager: null },
          ],
        },
      },
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
      goals: {
        participantsWithGoals: 10,
        goals: 24,
        completed: 9,
        avgProgress: 61.5,
        byDepartment: [
          {
            label: "Ingeniería",
            n: 7,
            other: false,
            peopleWithGoals: 6,
            goals: 15,
            completed: 6,
            inProgress: 8,
            closed: 1,
            overdue: 2,
            avgProgress: 64.2,
          },
          {
            label: "Otros",
            n: 5,
            other: true,
            peopleWithGoals: 4,
            goals: 9,
            completed: 3,
            inProgress: 6,
            closed: 0,
            overdue: 1,
            avgProgress: 57,
          },
        ],
        byManager: [
          {
            label: "Equipo 1",
            n: 6,
            other: false,
            peopleWithGoals: 5,
            goals: 12,
            completed: 5,
            inProgress: 7,
            closed: 0,
            overdue: 1,
            avgProgress: 60,
          },
        ],
        buckets: [
          {
            from: 0,
            to: 50,
            people: 6,
            meanRetention: 3.5,
            meanEngagement: 3.25,
            meanPositiveShare: 0.4,
            hidden: false,
          },
          {
            from: 50,
            to: 100,
            people: null,
            meanRetention: null,
            meanEngagement: null,
            meanPositiveShare: null,
            hidden: true,
          },
        ],
        withoutGoals: null,
        outliers: {
          thresholds: {
            goalsHigh: 80,
            goalsLow: 30,
            riskThreshold: 2,
            indicatorHigh: 4,
          },
          doneButLow: { count: 5, people: [] },
          behindButHigh: { count: null, people: [] },
        },
        suppressed: { byDepartment: 0, byManager: 0, buckets: 4 },
      },
      people: null,
    },
    ...over,
  };
}
