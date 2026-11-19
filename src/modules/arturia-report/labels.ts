// The strings of the exported HTML. The `Arturia` namespace of the app
// messages (plain JSON import; the CLI has no next-intl), so the es/en parity
// test covers them; and, for the open-text reading (#129), the report's own
// vocabulary below: the names of every question, theme, signal and substance in
// both languages, so the HTML never shows a raw key.
import type { LocalizedText } from "@/db/schema/rating-scales";
import { yesNoKindOf } from "@/modules/qualitative-analysis/yes-no-kind";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

export const reportLocales = ["es", "en"] as const;
export type ReportLocale = (typeof reportLocales)[number];

export type Labels = (typeof es)["Arturia"];

export const labelsFor = (locale: ReportLocale = "es"): Labels =>
  locale === "en" ? en.Arturia : es.Arturia;

/** Spanish, the default (the HTML is for People). */
export const labels = labelsFor("es");

// ---------------------------------------------------------------------------
// The open-text reading: the report's own vocabulary
// ---------------------------------------------------------------------------

/** The question dimensions that have a name of their own. */
const KNOWN = ["strengths", "improvement", "valued", "best_work", "other"];

const ES_NAMES = {
  dimensions: {
    strengths: "Fortalezas",
    improvement: "Oportunidades de mejora",
    valued: "Reconocimiento de valor",
    best_work: "Qué me ayudaría a hacer mi mejor trabajo",
    other: "Otros",
  },
  /** The four yes/no questions Santex runs, by what they ask. */
  questions: {
    security: "Seguridad de la información",
    conversations: "Conversaciones frecuentes",
    social: "Impacto social",
    environmental: "Impacto ambiental",
  },
  customQuestion: "Pregunta personalizada {n}",
  substances: {
    none: "Sin contenido",
    generic: "Genérico",
    specific: "Concreto",
  },
  signals: {
    workload: "Carga de trabajo",
    attrition: "Intención de irse",
    conflict: "Conflicto",
    recognition: "Falta de reconocimiento",
    stagnation: "Estancamiento",
    company_request: "Pedido a la empresa",
    role_fit: "Encaje con el rol",
  },
  themes: {
    proyecto: "Proyecto",
    equipo: "Equipo",
    comunicacion: "Comunicación",
    crecimiento: "Crecimiento",
    cultura: "Cultura",
    procesos: "Procesos",
    bienestar: "Bienestar",
    reconocimiento: "Reconocimiento",
    planificacion: "Planificación",
    calidad: "Calidad",
    liderazgo: "Liderazgo",
    colaboracion: "Colaboración",
    tecnica: "Técnica",
    documentacion: "Documentación",
    proactividad: "Proactividad",
    negocio: "Negocio",
    aprendizaje: "Aprendizaje",
    voluntariado: "Voluntariado",
    donaciones: "Donaciones",
    reciclaje: "Reciclaje",
    consumo: "Consumo responsable",
    educacion: "Educación",
    movilidad: "Movilidad",
  },
  sides: { self: "Autoevaluación", manager: "Manager" },
  yes: "Sí",
  no: "No",
  hiddenCell: "–",
  text: {
    unit: "La unidad es la persona: cada persona cuenta una vez por pregunta y lado (n = personas) y la autoevaluación y el manager nunca se mezclan. «–» es una cifra que no se publica por ser de menos personas que el grupo mínimo (o por permitir deducirla).",
    provenanceTitle: "Procedencia de la lectura",
    demo: "Lectura de demostración (heurística de palabras clave): no es un análisis; sus etiquetas no deben leerse como una conclusión.",
    readBy: "Leído por {list}",
    noMachine: "Sin lectura automática: solo etiquetas importadas o corregidas",
    lastRun: "última corrida {date}",
    counts:
      "{labels} respuestas leídas · {corrected} corregidas por personas ({human}) · {imported} importadas",
    people: "Personas",
    withSignal: "Con alguna señal",
    notValued: "No se sienten valoradas (1–2)",
    ofPeople: "{n} de {of} personas",
    question: "Pregunta",
    side: "Lado",
    group: "Grupo",
    substanceTitle: "Sustancia del feedback",
    substanceHint:
      "¿La respuesta dice algo? Concreto: un hecho, ejemplo o acción; genérico: un rasgo sin ancla; sin contenido: no responde lo que se pregunta. Por pregunta y lado.",
    managerFeedbackTitle: "Calidad del feedback de los managers",
    managerFeedbackHint:
      "Cada persona según la más débil de las dos respuestas de su manager (fortalezas y mejora): concreto = las dos con ancla.",
    cutDepartment: "Por área",
    cutAccount: "Por cuenta",
    cutDm: "Por DM",
    hiddenRows: "Cifras no publicadas (menos personas que el mínimo)",
    themesOf: "Temas: {question}",
    themesHint:
      "Personas que citan cada tema, autoevaluación y manager lado a lado; entre paréntesis, el % de las personas de ese lado con respuesta.",
    theme: "Tema",
    sideOf: "{side} (n = {n})",
    quotes: "Citas",
    agreementTitle: "Coincidencia persona–manager",
    agreementHint:
      "De las personas con las dos respuestas (propia y del manager) leídas con temas, cuántas nombran al menos un mismo tema. Puntos ciegos: temas de mejora que el manager nombra y la persona no.",
    agreementOf: "Coinciden en {question}",
    both: "Con las dos respuestas",
    shared: "Coinciden",
    blindPeople: "Con algún punto ciego (mejora)",
    blindSpots: "Puntos ciegos más frecuentes",
    signalsTitle: "Señales a atender",
    signalsHint:
      "Personas cuyas respuestas (propias o de su manager) dicen algo a atender. Una persona puede tener varias señales.",
    signal: "Señal",
    inOwn: "En su autoevaluación",
    inManager: "En la del manager",
    noSignals: "Ninguna señal con los filtros actuales.",
    yesNoTitle: "Preguntas Sí / No",
    yesNoHint:
      "Personas que respondieron Sí y No, por pregunta y lado. Seguridad de la información = No y conversaciones frecuentes = No son alertas.",
    alertSecurity:
      "Seguridad de la información: {n} de {of} personas ({share}) responden que No cumplen con las políticas.",
    alertConversations:
      "Conversaciones frecuentes: en {n} de {of} personas ({share}) el manager responde que No habla con la frecuencia suficiente.",
    initiatives: "Tipos de iniciativa (el «cómo»)",
    initiativesOf: "{question} · {n} personas con un «cómo»",
    closedTitle: "Preguntas cerradas",
    closedHint:
      "Valoración (1–4) como escala y «mejor trabajo» como distribución de opciones: nunca como sentimiento. Personas.",
    valuedTitle: "¿Qué tan bien reconoce la empresa mi valor? (1–4)",
    valuedTotal: "Total",
    bestWorkTitle: "¿Qué me ayudaría a hacer mi mejor trabajo? · {n} personas",
    toneTitle: "Tono (secundario)",
    toneHint:
      "Solo texto libre, por pregunta y lado. La pregunta condiciona el tono: «¿cómo podría mejorar?» invita a lo constructivo; no compare preguntas entre sí. Una lectura automática del tono es la menos confiable de las lecturas.",
    empty: "Sin datos con los filtros actuales.",
  },
};

type Names = typeof ES_NAMES;

const EN_NAMES: Names = {
  dimensions: {
    strengths: "Strengths",
    improvement: "Areas to improve",
    valued: "Recognition of value",
    best_work: "What would help me do my best work",
    other: "Other",
  },
  questions: {
    security: "Information security",
    conversations: "Frequent conversations",
    social: "Social impact",
    environmental: "Environmental impact",
  },
  customQuestion: "Custom question {n}",
  substances: {
    none: "No content",
    generic: "Generic",
    specific: "Specific",
  },
  signals: {
    workload: "Workload",
    attrition: "Intent to leave",
    conflict: "Conflict",
    recognition: "Lack of recognition",
    stagnation: "Stagnation",
    company_request: "Request to the company",
    role_fit: "Role fit",
  },
  themes: {
    proyecto: "Project",
    equipo: "Team",
    comunicacion: "Communication",
    crecimiento: "Growth",
    cultura: "Culture",
    procesos: "Processes",
    bienestar: "Wellbeing",
    reconocimiento: "Recognition",
    planificacion: "Planning",
    calidad: "Quality",
    liderazgo: "Leadership",
    colaboracion: "Collaboration",
    tecnica: "Technical",
    documentacion: "Documentation",
    proactividad: "Proactivity",
    negocio: "Business",
    aprendizaje: "Learning",
    voluntariado: "Volunteering",
    donaciones: "Donations",
    reciclaje: "Recycling",
    consumo: "Responsible consumption",
    educacion: "Education",
    movilidad: "Mobility",
  },
  sides: { self: "Self-assessment", manager: "Manager" },
  yes: "Yes",
  no: "No",
  hiddenCell: "–",
  text: {
    unit: "The unit is the person: each person counts once per question and side (n = people), and self-assessment and manager are never mixed. “–” is a figure that is not published because it covers fewer people than the minimum group (or would let it be worked out).",
    provenanceTitle: "Where the reading comes from",
    demo: "Demo reading (keyword heuristic): not an analysis; its labels must not be read as a conclusion.",
    readBy: "Read by {list}",
    noMachine: "No automatic reading: only imported or corrected labels",
    lastRun: "last run {date}",
    counts:
      "{labels} answers read · {corrected} corrected by people ({human}) · {imported} imported",
    people: "People",
    withSignal: "With some signal",
    notValued: "Do not feel valued (1–2)",
    ofPeople: "{n} of {of} people",
    question: "Question",
    side: "Side",
    group: "Group",
    substanceTitle: "Substance of the feedback",
    substanceHint:
      "Does the answer say anything? Specific: a fact, example or action; generic: a trait with no anchor; no content: it does not answer what was asked. Per question and side.",
    managerFeedbackTitle: "Quality of the managers' feedback",
    managerFeedbackHint:
      "Each person by the weaker of their manager's two answers (strengths and improvement): specific = both anchored.",
    cutDepartment: "By area",
    cutAccount: "By account",
    cutDm: "By DM",
    hiddenRows: "Figures not published (fewer people than the minimum)",
    themesOf: "Themes: {question}",
    themesHint:
      "People who cite each theme, self-assessment and manager side by side; in brackets, the % of the people of that side with an answer.",
    theme: "Theme",
    sideOf: "{side} (n = {n})",
    quotes: "Quotes",
    agreementTitle: "Person–manager agreement",
    agreementHint:
      "Of the people whose two answers (their own and their manager's) were read with themes, how many name at least one same theme. Blind spots: improvement themes the manager names and the person does not.",
    agreementOf: "Agree on {question}",
    both: "With both answers",
    shared: "Agree",
    blindPeople: "With some blind spot (improvement)",
    blindSpots: "Most frequent blind spots",
    signalsTitle: "Signals to attend",
    signalsHint:
      "People whose answers (their own or their manager's) say something to attend to. A person can have several signals.",
    signal: "Signal",
    inOwn: "In their self-assessment",
    inManager: "In the manager's",
    noSignals: "No signal with the current filters.",
    yesNoTitle: "Yes / No questions",
    yesNoHint:
      "People who answered Yes and No, per question and side. Information security = No and frequent conversations = No are alerts.",
    alertSecurity:
      "Information security: {n} of {of} people ({share}) answer that they do not comply with the policies.",
    alertConversations:
      "Frequent conversations: for {n} of {of} people ({share}) the manager answers that they do not speak often enough.",
    initiatives: "Types of initiative (the “how”)",
    initiativesOf: "{question} · {n} people with a “how”",
    closedTitle: "Closed questions",
    closedHint:
      "Valued (1–4) as a scale and “best work” as a distribution of options: never as a sentiment. People.",
    valuedTitle: "How well does the company recognize my value? (1–4)",
    valuedTotal: "Total",
    bestWorkTitle: "What would help me do my best work? · {n} people",
    toneTitle: "Tone (secondary)",
    toneHint:
      "Free text only, per question and side. The question shapes the tone: “how could I improve?” invites the constructive; do not compare questions with each other. An automatic reading of tone is the least reliable of the readings.",
    empty: "No data with the current filters.",
  },
};

/** The report's vocabulary of the open-text reading, per language. */
export const readingNames = (locale: ReportLocale = "es"): Names =>
  locale === "en" ? EN_NAMES : ES_NAMES;

/** "{n} of {of}" style templates: `{name}` replaced by the value. */
export const fill = (
  template: string,
  values: Record<string, string | number>,
): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in values ? String(values[k]) : m,
  );

/** A key nobody named: "salud_mental" -> "Salud mental". */
export const humanize = (key: string): string => {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toLocaleUpperCase("es") + words.slice(1);
};

const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The label of a theme: its name in the language, else the key humanized. */
export function themeLabel(key: string, locale: ReportLocale = "es"): string {
  const themes: Record<string, string> = readingNames(locale).themes;
  return Object.hasOwn(themes, key) ? themes[key] : humanize(key);
}

/** The label of a signal, a substance (the keys of their vocabularies). */
export function signalLabel(key: string, locale: ReportLocale = "es"): string {
  const signals: Record<string, string> = readingNames(locale).signals;
  return Object.hasOwn(signals, key) ? signals[key] : humanize(key);
}
export function substanceLabel(
  key: string,
  locale: ReportLocale = "es",
): string {
  const substances: Record<string, string> = readingNames(locale).substances;
  return Object.hasOwn(substances, key) ? substances[key] : humanize(key);
}

/**
 * The short name of one of the four yes/no questions Santex runs (information
 * security, frequent conversations, social impact, environmental impact) from
 * the question's own text, else null. Two questions can both be "impact" for
 * the qualitative module; here they are told apart.
 */
export function santexQuestionName(
  prompt: LocalizedText,
  locale: ReportLocale = "es",
): string | null {
  const names = readingNames(locale).questions;
  const kind = yesNoKindOf(prompt);
  if (kind === "security") return names.security;
  if (kind === "conversations") return names.conversations;
  if (kind !== "impact") return null;
  const text = fold(`${prompt.es} ${prompt.en}`);
  if (/ambient|environment|sustentab|sostenib|sustainab/.test(text)) {
    return names.environmental;
  }
  if (/social/.test(text)) return names.social;
  return null;
}

/**
 * The label of a question key in the report's language: a known key has its
 * name; a question that is one of Santex's four yes/no (or the open "how"
 * beside it) its short name; any other `prompt` its own text; a `custom_<n>`
 * without one "Custom question n"; the rest the key humanized. Never a raw key.
 */
export function questionLabel(
  dimension: string,
  prompt: LocalizedText | undefined,
  locale: ReportLocale = "es",
): string {
  const names = readingNames(locale);
  if (KNOWN.includes(dimension)) {
    return (names.dimensions as Record<string, string>)[dimension];
  }
  if (prompt) {
    const short = santexQuestionName(prompt, locale);
    if (short) return short;
    const own =
      prompt[locale]?.trim() || prompt.es?.trim() || prompt.en?.trim();
    if (own) return own;
  }
  const n = /^custom_(\d+)$/.exec(dimension)?.[1];
  return n ? fill(names.customQuestion, { n }) : humanize(dimension);
}
