import type { ArturiaReport, QualitativeSection } from "./schema";

/** Dimension keys of the four Santex yes/no questions as an import names them (slug + hash). */
export const SECURITY =
  "custom_am_i_following_all_information_security_02c50291";
export const SOCIAL =
  "custom_do_i_contribute_with_initiatives_related_097f5c06";
export const ENVIRONMENTAL =
  "custom_do_i_contribute_with_initiatives_related_80969923";
export const CONVERSATIONS =
  "custom_do_i_speak_with_this_employee_frequently_d2f1a686";

/**
 * A qualitative section as the real one reads: provenance from the mock, a
 * custom question per key, some cells hidden (null), quotes (one hostile),
 * and themes and signals of the vocabularies.
 */
export function sampleQualitative(): NonNullable<QualitativeSection> {
  const feedback = (people: number) => ({
    groups: [
      {
        label: "Ingeniería",
        other: false,
        people,
        none: 1,
        generic: 3,
        specific: people - 4,
      },
      {
        label: "Otros",
        other: true,
        people: 6,
        none: null,
        generic: null,
        specific: null,
      },
    ],
    suppressed: 0,
  });
  const signalCut = {
    groups: [
      {
        label: "Ingeniería",
        other: false,
        people: 9,
        withAny: 4,
        counts: { workload: 3, attrition: null, conflict: 0 },
      },
    ],
    suppressed: 0,
  };
  return {
    people: 12,
    provenance: {
      labels: 40,
      human: 4,
      imported: 0,
      machine: 36,
      correctedShare: 0.1,
      demo: true,
      providers: [{ provider: "mock", model: null, labels: 36 }],
      lastRun: {
        provider: "mock",
        model: null,
        finishedAt: "2026-11-18T10:00:00.000Z",
      },
    },
    questions: [
      { dimension: "improvement", label: "Oportunidades de mejora" },
      { dimension: "strengths", label: "Fortalezas" },
      { dimension: SOCIAL, label: "Impacto social" },
      { dimension: ENVIRONMENTAL, label: "Impacto ambiental" },
      { dimension: SECURITY, label: "Seguridad de la información" },
      { dimension: CONVERSATIONS, label: "Conversaciones frecuentes" },
    ],
    substance: [
      {
        dimension: "strengths",
        side: "self",
        people: 12,
        none: 1,
        generic: 4,
        specific: 7,
      },
      {
        dimension: "strengths",
        side: "manager",
        people: 10,
        none: null,
        generic: null,
        specific: null,
      },
    ],
    managerFeedback: {
      byDepartment: feedback(10),
      byAccount: feedback(8),
      byDm: feedback(7),
    },
    themes: [
      {
        dimension: "strengths",
        people: { self: 12, manager: 10 },
        rows: [
          {
            theme: "comunicacion",
            self: 5,
            manager: null,
            quotes: {
              self: ["[P1] comunica bien </script> http://x.example"],
              manager: [],
            },
          },
          {
            theme: "planificacion",
            self: 3,
            manager: 2,
            quotes: { self: [], manager: [] },
          },
        ],
      },
      {
        dimension: "improvement",
        people: { self: 12, manager: null },
        rows: [
          {
            theme: "proactividad",
            self: 4,
            manager: null,
            quotes: { self: [], manager: [] },
          },
        ],
      },
    ],
    agreement: {
      rows: [{ dimension: "strengths", both: 9, shared: 6 }],
      blindSpots: [{ theme: "proactividad", people: 3 }],
      blindPeople: 3,
      improvementBoth: 8,
    },
    signals: {
      people: 12,
      withAny: 5,
      rows: [
        { signal: "workload", people: 4, self: 3, manager: 2 },
        { signal: "attrition", people: 2, self: null, manager: null },
      ],
      byDepartment: signalCut,
      byAccount: signalCut,
      byDm: signalCut,
      byIndicator: [
        {
          indicator: "retention",
          value: 5,
          label: "Haría todo para retenerlo",
          people: 6,
          withSignal: 1,
        },
        {
          indicator: "retention",
          value: 2,
          label: null,
          people: 6,
          withSignal: null,
        },
        {
          indicator: "engagement",
          value: 4,
          label: "Muy comprometido",
          people: 12,
          withSignal: 5,
        },
      ],
    },
    yesNo: {
      byGroup: [
        {
          dimension: SECURITY,
          byDepartment: {
            groups: [
              { label: "Ingeniería", other: false, people: 9, yes: 7, no: 2 },
              { label: "Otros", other: true, people: 6, yes: null, no: null },
            ],
            suppressed: 0,
          },
          byAccount: { groups: [], suppressed: 0 },
          byDm: { groups: [], suppressed: 0 },
        },
      ],
      byCycle: [
        {
          dimension: SECURITY,
          cycles: [
            {
              cycleId: "a",
              cycleName: "2025-H1",
              periodEnd: "2025-06-30",
              people: 10,
              yes: 8,
              no: 2,
            },
            {
              cycleId: "b",
              cycleName: "2025-H2",
              periodEnd: "2025-12-31",
              people: 12,
              yes: 9,
              no: 3,
            },
            {
              cycleId: "c",
              cycleName: "2026-H1",
              periodEnd: "2026-06-30",
              people: 12,
              yes: null,
              no: null,
            },
          ],
        },
      ],
      rows: [
        {
          dimension: SECURITY,
          side: "self",
          kind: "security",
          people: 12,
          yes: 9,
          no: 3,
          alert: true,
        },
        {
          dimension: CONVERSATIONS,
          side: "manager",
          kind: "conversations",
          people: 12,
          yes: null,
          no: null,
          alert: false,
        },
        {
          dimension: SOCIAL,
          side: "self",
          kind: "impact",
          people: 12,
          yes: 8,
          no: 4,
          alert: false,
        },
        {
          dimension: ENVIRONMENTAL,
          side: "self",
          kind: "impact",
          people: 12,
          yes: 6,
          no: 6,
          alert: false,
        },
      ],
      initiatives: [
        {
          dimension: SOCIAL,
          people: 8,
          rows: [{ theme: "voluntariado", people: 5 }],
        },
      ],
    },
    closed: {
      valued: {
        people: 12,
        counts: [1, 3, 5, 3],
        labels: ["No me siento valorado", null, null, "Me siento valorado"],
        notValued: 4,
        byDepartment: {
          groups: [
            {
              label: "Ingeniería",
              other: false,
              people: 8,
              counts: [1, 2, 3, 2],
              notValued: 3,
            },
            {
              label: "Otros",
              other: true,
              people: 4,
              counts: [null, null, 2, 1],
              notValued: null,
            },
          ],
          suppressed: 0,
        },
        byAccount: { groups: [], suppressed: 0 },
        byDm: { groups: [], suppressed: 0 },
        byCycle: [
          {
            cycleId: "a",
            cycleName: "2025-H2",
            periodEnd: "2025-12-31",
            people: 10,
            counts: [2, 2, 3, 3],
            notValued: 4,
          },
          {
            cycleId: "b",
            cycleName: "2026-H1",
            periodEnd: "2026-06-30",
            people: 12,
            counts: [1, 3, 5, 3],
            notValued: 4,
          },
        ],
      },
      bestWork: {
        people: 12,
        options: [
          { option: "nothing_i_have_all_i_need", label: "Nada", people: 7 },
          { option: "other", label: null, people: null },
        ],
      },
    },
    tone: [
      {
        dimension: "strengths",
        side: "self",
        people: 12,
        positive: 7,
        constructive: 1,
        neutral: 2,
        mixed: 1,
        negative: 1,
      },
    ],
  };
}

/** A small valid report (unit tests of the renderers). */
export function sampleReport(over: Partial<ArturiaReport> = {}): ArturiaReport {
  return {
    schemaVersion: "arturia-report.v1",
    schemaMinor: 6,
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
            applicable: true,
            draft: null,
            declined: null,
          },
          {
            relationship: "manager",
            total: 11,
            submitted: 6,
            applicable: true,
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
            applicable: true,
            other: false,
          },
          {
            label: "Otros",
            relationship: "self",
            n: 5,
            total: 5,
            submitted: 3,
            applicable: true,
            other: true,
          },
        ],
        byManager: [
          {
            label: "Equipo 1",
            relationship: "self",
            n: 6,
            total: 0,
            submitted: 0,
            applicable: false,
            other: false,
          },
          {
            label: "Equipo 1",
            relationship: "manager",
            n: 6,
            total: 6,
            submitted: 4,
            applicable: true,
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
      qualitative: sampleQualitative(),
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
            inProgress: 6,
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
            inProgress: 5,
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
            inProgress: 6,
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
