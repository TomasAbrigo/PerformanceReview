import { COMPANY_NAME } from "./catalog";

/**
 * Bamboo's standard assessment questions (docs/research/07). Answers to the
 * single-select ones are exported as letters; the others are free text.
 */
export const SELF_QUESTIONS = {
  q1: {
    text: `How well does ${COMPANY_NAME} recognize my value?`,
    options: {
      A: "I feel highly valued",
      B: "I sometimes feel valued",
      C: "I am not sure others value me",
      D: "I do not feel valued",
    },
  },
  q2: {
    text: "What would have the greatest impact on my ability to do my best work more often?",
    options: {
      A: "Company direction better defined",
      B: "Coworkers more committed",
      C: "Work that fits my strengths",
      D: "Nothing, I have all I need",
      E: "Other",
    },
  },
  q3: { text: "What are some things I do well?" },
  q4: { text: "How could I improve?" },
} as const;

export const MANAGER_QUESTIONS = {
  q1: {
    text: "If [Employee] got a job offer elsewhere, I would...",
    options: {
      A: "Do everything to keep them",
      B: "Try to convince them to stay",
      C: "Need to think about it",
      D: "Wish them well",
      E: "Be relieved",
    },
  },
  q2: {
    text: "How engaged is [Employee] at work?",
    options: {
      A: "Highly engaged",
      B: "Engaged",
      C: "Somewhat engaged",
      D: "Not very engaged",
      E: "No engagement, checked out",
    },
  },
  q3: { text: "What are some things [Employee] does well?" },
  q4: { text: "How could [Employee] improve?" },
} as const;

/**
 * Santex's real custom questions (issue #123), the same in every cycle: the
 * employee answers three (two "yes/no and how", one yes/no), the manager one
 * (yes/no). Their answers are mostly "Sí". The open texts of the "how" (and
 * of strengths, improvement and the "Other" of best work) come from the text
 * bank (`text-bank.ts`, issue #127).
 */
export const REAL_CUSTOM_QUESTIONS = {
  self: [
    'Do I contribute with initiatives related to "Social impact"? How?',
    'Do I contribute with initiatives related to "Environmental impact"? How?',
    "Am I following all Information Security Policies and Procedures of the Company?",
  ],
  manager: [
    "Do I speak with this employee frequently enough that I consider myself to be aware of his/her needs and current situation?",
  ],
} as const;

/** How people answer the plain yes/no custom questions. */
export const YES_NO_ANSWERS = ["Sí", "Si", "Sí", "Yes", "Sí", "No"] as const;

/** Two company-defined questions answered on a 1-5 rating scale (the older Employee Performance export only). */
export const CUSTOM_QUESTIONS = [
  {
    employeeText: "Mis objetivos del período están claros.",
    managerText: "Los objetivos de [Employee] para el período están claros.",
  },
  {
    employeeText: "Tengo las herramientas para hacer bien mi trabajo.",
    managerText: "[Employee] entrega resultados con la calidad esperada.",
  },
] as const;

export const FOLLOW_UP_NOTES = [
  "Acordamos objetivos de desarrollo para el próximo semestre.",
  "Revisar carga de trabajo en el próximo 1:1.",
  "Explorar rol de mentor para nuevos ingresos.",
  "Conversación pendiente sobre plan de carrera.",
] as const;
