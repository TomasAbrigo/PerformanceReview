import type { CompanyFixture, FixtureAssessment } from "../company";
import type { ProgressStatus } from "../company/types";
import {
  MANAGER_IMPROVEMENTS,
  MANAGER_STRENGTHS,
  SELF_IMPROVEMENTS,
  SELF_STRENGTHS,
} from "../company/questions";
import { toCsv } from "./csv";
import type { FixtureFile } from "./files";
import { createReportNamer } from "./report-names";

/**
 * Bamboo's REAL report shapes (PRD iteration 3, #83): the raw assessments
 * report (custom report: EEID, Review Period Start, English labels, custom
 * question pairs) and Assessment Progress as exported (grouped by person).
 * Synthetic data only.
 */

export const ASSESSMENTS_REPORT_HEADER = [
  "EEID",
  "Review Period Start",
  "Correo electrónico del trabajo",
  "Employee - How well does [Company] recognize my value?",
  "Manager - Does [Employee] feel valued? (Performance Score)",
  "Employee - What would help me do my best work?",
  "Employee - What do I do well?",
  "Employee - How could I improve?",
  "Manager - How engaged is [Employee]? (Engagement Score)",
  "Manager - What does [Employee] do well?",
  "Manager - How could [Employee] improve?",
  ...[1, 2, 3].flatMap((n) => [
    `Employee - Custom Question ${n}`,
    `Employee - Custom Answer ${n}`,
  ]),
  ...[1, 2, 3].flatMap((n) => [
    `Manager - Custom Question ${n}`,
    `Manager - Custom Answer ${n}`,
  ]),
  "Self Assessment Completed Date",
  "Manager Assessment Completed Date",
  "Manager At Time Of Assessment",
] as const;

export const ASSESSMENT_STATUS_HEADER = [
  "Empleado",
  "Período",
  "Autoevaluación",
  "Evaluación del manager",
  "Notas de seguimiento",
] as const;

/** Self Q1 letter (A = best) -> Bamboo's English label. */
const VALUED = {
  A: "I feel I am highly valued.",
  B: "I sometimes feel valued.",
  C: "I'm not sure others value me.",
  D: "I don't feel valued.",
} as const;

const BEST_WORK = {
  A: "The company direction or purpose was better defined.",
  B: "Coworkers were more committed to doing great work.",
  C: "Work that better fits my strengths.",
  D: "Nothing, I have all I need.",
  E: "Other",
} as const;

const OTHER_TEXTS = [
  "Other Comentario: Más tiempo para capacitarme.",
  "Other: Menos reuniones y más foco.",
] as const;

/** Manager Q1 letter -> retention label; some carry the employee's name. */
const retention = (letter: string, name: string): string =>
  ({
    A: "I would do everything I can to keep them",
    B: `I would try to convince them to stay. ${name} would be difficult to replace`,
    C: "I would think about it, but I would be okay either way.",
    D: "I would wish them well.",
    E: "I would be relieved.",
  })[letter] ?? letter;

const ENGAGEMENT: Record<string, string> = {
  A: "Highly engaged and a great attitude.",
  B: "Engaged and a good attitude.",
  C: "Medium engagement and an okay attitude.",
  D: "Low engagement and a poor attitude.",
  E: "Not engaged at all and a negative attitude.",
};

/**
 * Review period starts, by cycle: Bamboo's cadence (29/3 and 29/9) except
 * the first, an irregular historical start.
 */
export function periodStartOf(company: CompanyFixture, cycle: number): string {
  if (cycle === 0) return `${company.cycles[0].periodStart.slice(0, 4)}-04-15`;
  const year = company.cycles[cycle].periodStart.slice(0, 4);
  return company.cycles[cycle].periodStart.slice(5) === "01-01"
    ? `${year}-03-29`
    : `${year}-09-29`;
}

/** The day before the next 29/3 or 29/9 cutoff (the app's default). */
export function periodEndOf(start: string): string {
  const year = Number(start.slice(0, 4));
  const next = [year, year + 1]
    .flatMap((y) => [`${y}-03-29`, `${y}-09-29`])
    .filter((d) => d > start)
    .sort()[0];
  const date = new Date(`${next}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** ISO -> MM/DD/YYYY, as Bamboo writes dates. */
export const usDate = (iso: string) =>
  `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/** Custom questions per cycle: their texts change between cycles. */
const CUSTOM_BY_CYCLE: { self: string[]; manager: string[] }[] = [
  {
    self: ["¿Qué logro del período destacarías?"],
    manager: ["¿Qué logro de [Employee] destacarías?"],
  },
  {
    self: [
      "¿Qué necesitás de tu líder?",
      "¿Cómo te sentís en tu proyecto actual?",
    ],
    manager: ["¿Qué rol podría asumir [Employee] el próximo semestre?"],
  },
  {
    self: [
      "¿Qué necesitás de tu líder?",
      "¿Cómo te sentís en tu proyecto actual?",
    ],
    manager: ["¿Qué rol podría asumir [Employee] el próximo semestre?"],
  },
  {
    self: [
      "¿Qué aprendiste este semestre?",
      "¿Qué te gustaría aprender?",
      "¿Cómo es tu relación con el cliente?",
    ],
    manager: [
      "¿Cómo es la relación de [Employee] con el cliente?",
      "¿Qué capacitación recomendarías para [Employee]?",
    ],
  },
  {
    self: ["¿Qué aprendiste este semestre?", "¿Qué te gustaría aprender?"],
    manager: ["¿Cómo es la relación de [Employee] con el cliente?"],
  },
];

const pick = <T>(pool: readonly T[], i: number): T => pool[i % pool.length];

const SELF_STATUS: Record<ProgressStatus, string> = {
  Submitted: "Completado",
  "In Progress": "En curso",
  "Not Started": "No iniciado",
};

/** Manager status as Bamboo words it, mixing the export's languages. */
const managerStatus = (status: ProgressStatus, who: string) =>
  status === "Submitted"
    ? `Completed by ${who}`
    : status === "In Progress"
      ? `In progress by ${who}`
      : `No iniciado por ${who}`;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function serializeRawReports(company: CompanyFixture): FixtureFile[] {
  const byId = new Map(company.employees.map((e) => [e.id, e]));
  const names = createReportNamer(company);
  const renames = new Map(
    company.identity.renames.map((r) => [r.employeeId, r]),
  );
  const emailIn = (employeeId: string, cycle: number) => {
    const rename = renames.get(employeeId);
    return rename && company.cycles[cycle].assessmentDue < rename.renamedOn
      ? rename.previousWorkEmail
      : byId.get(employeeId)!.workEmail;
  };
  const managerName = (id: string | null) => (id ? names.current(id) : "");

  const reportRows: string[][] = [];
  let unmappedLeft = 1;
  company.assessments.forEach((a: FixtureAssessment, i) => {
    const selfDone = a.selfStatus === "Submitted" && a.selfAnswers;
    const managerDone = a.managerStatus === "Submitted" && a.managerAnswers;
    if (!selfDone && !managerDone) return;
    const outsider = a.employeeId === null;
    const name = outsider
      ? a.outsiderName!
      : names.inCycle(a.employeeId!, a.cycle);
    const custom = CUSTOM_BY_CYCLE[a.cycle % CUSTOM_BY_CYCLE.length];
    const self = selfDone ? a.selfAnswers! : null;
    const manager = managerDone ? a.managerAnswers! : null;
    const bestWork = self
      ? self.q2 === "E"
        ? pick(OTHER_TEXTS, i)
        : BEST_WORK[self.q2 as keyof typeof BEST_WORK]
      : "";
    let engagement = manager ? (ENGAGEMENT[manager.q2] ?? manager.q2) : "";
    // One label Bamboo never had: an answer quality issue on import.
    if (manager && a.cycle === 1 && unmappedLeft > 0) {
      engagement = "Hard to say yet.";
      unmappedLeft--;
    }
    const customCells = (side: "self" | "manager") =>
      [0, 1, 2].flatMap((n) => {
        const question = custom[side][n];
        const answered = side === "self" ? self : manager;
        if (!question || !answered) return ["", ""];
        const pool =
          side === "self"
            ? n % 2 === 0
              ? SELF_STRENGTHS
              : SELF_IMPROVEMENTS
            : n % 2 === 0
              ? MANAGER_STRENGTHS
              : MANAGER_IMPROVEMENTS;
        return [question, pick(pool, i + n)];
      });
    reportRows.push([
      outsider ? `9${String(900 + (i % 100)).padStart(4, "0")}` : a.employeeId!,
      usDate(periodStartOf(company, a.cycle)),
      outsider
        ? `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.invalid`
        : emailIn(a.employeeId!, a.cycle),
      self ? VALUED[self.q1 as keyof typeof VALUED] : "",
      manager ? retention(manager.q1, name) : "",
      bestWork,
      self?.q3 ?? "",
      self?.q4 ?? "",
      engagement,
      manager?.q3 ?? "",
      manager?.q4 ?? "",
      ...customCells("self"),
      ...customCells("manager"),
      self && a.selfSubmittedOn ? usDate(a.selfSubmittedOn) : "",
      manager && a.managerSubmittedOn ? usDate(a.managerSubmittedOn) : "",
      manager ? managerName(a.managerIdAtReview) : "",
    ]);
  });
  // By period start, then EEID (MM/DD/YYYY sorts by its ISO form).
  const iso = (us: string) =>
    `${us.slice(6)}-${us.slice(0, 2)}-${us.slice(3, 5)}`;
  reportRows.sort((x, y) => byText(iso(x[1]), iso(y[1])) || byText(x[0], y[0]));

  // Assessment Progress, grouped by person (current name + employee number).
  const byEmployee = new Map<string, FixtureAssessment[]>();
  for (const a of company.assessments) {
    if (a.employeeId === null) continue;
    byEmployee.set(a.employeeId, [...(byEmployee.get(a.employeeId) ?? []), a]);
  }
  const people = [...byEmployee.keys()].sort(
    (x, y) => byText(names.current(x), names.current(y)) || byText(x, y),
  );
  const statusRows: string[][] = [];
  for (const id of people) {
    const employee = byId.get(id)!;
    statusRows.push([
      `${names.current(id)} ${employee.employeeNumber}`,
      "",
      "",
      "",
      "",
    ]);
    const rows = [...byEmployee.get(id)!].sort((x, y) => x.cycle - y.cycle);
    for (const a of rows) {
      const start = periodStartOf(company, a.cycle);
      const manager = a.managerIdAtReview ?? employee.managerId;
      statusRows.push([
        "",
        `${usDate(start)} - ${usDate(periodEndOf(start))}`,
        SELF_STATUS[a.selfStatus],
        manager ? managerStatus(a.managerStatus, names.current(manager)) : "",
        a.followUpNote ?? "",
      ]);
    }
  }

  return [
    {
      path: "assessments-report.csv",
      content: toCsv(ASSESSMENTS_REPORT_HEADER, reportRows),
    },
    {
      path: "assessment-status.csv",
      content: toCsv(ASSESSMENT_STATUS_HEADER, statusRows),
    },
  ];
}
