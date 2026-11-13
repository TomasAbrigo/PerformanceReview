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

/** Two company-defined questions answered on a 1-5 rating scale. */
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

export const SELF_STRENGTHS = [
  "Soy constante y cumplo con lo que me comprometo.",
  "Trabajo bien en equipo y ayudo a quien lo necesita.",
  "Aprendo rápido herramientas nuevas.",
  "Comunico con claridad los avances y los bloqueos.",
  "Me hago cargo de los problemas hasta resolverlos.",
  'Mi mejor trabajo fue el proyecto "Norte": entregamos a tiempo, sin retrabajo.',
  "Documento lo que hago, para que otros puedan continuar.",
  "Tengo buena relación con otras áreas, y eso agiliza los pedidos.",
] as const;

export const SELF_IMPROVEMENTS = [
  "Quiero delegar más y no cargar con todo.",
  "Necesito mejorar la planificación de mis tiempos.",
  "Me gustaría animarme a liderar reuniones.",
  "Puedo ser más proactivo pidiendo feedback.",
  "Tengo que priorizar mejor cuando llegan varios pedidos a la vez.",
  "Quiero profundizar en el área técnica,\ny a la vez entender mejor el negocio.",
] as const;

export const MANAGER_STRENGTHS = [
  "Es confiable: cuando dice que algo está, está.",
  "Tiene muy buena actitud con el equipo y con clientes internos.",
  "Resuelve con autonomía y pide ayuda cuando corresponde.",
  "Aporta ideas concretas en las retros.",
  "Tiene mucha calidad en lo que entrega.",
  "Es referente para los que recién ingresan.",
  'Su análisis del caso "Sur" cambió la decisión del comité.',
] as const;

export const MANAGER_IMPROVEMENTS = [
  "Puede anticipar más los riesgos y avisar antes.",
  "Le sugiero comunicar más hacia arriba lo que logra.",
  "Debería tomar más ownership de proyectos transversales.",
  "Tiene que cuidar los tiempos de respuesta en reuniones con otras áreas.",
  "Puede ganar visibilidad compartiendo sus aprendizajes con el resto del equipo.",
  "Sería bueno trabajar la delegación, y a la vez el seguimiento.",
] as const;

export const FOLLOW_UP_NOTES = [
  "Acordamos objetivos de desarrollo para el próximo semestre.",
  "Revisar carga de trabajo en el próximo 1:1.",
  "Explorar rol de mentor para nuevos ingresos.",
  "Conversación pendiente sobre plan de carrera.",
] as const;
