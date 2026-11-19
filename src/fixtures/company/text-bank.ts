/**
 * The bank of open-text answers of the synthetic company, each with the
 * reading a careful person would give it (issue #127): a hand-labelled gold
 * set. The generator draws the answers of the reports from it
 * (`./texts.ts`) and the analysis evaluation scores providers against it.
 *
 * The vocabulary is the one of the qualitative analysis, copied here on
 * purpose (this file imports nothing from the modules).
 *
 * How a text is read (keep new entries consistent with these rules):
 *
 * - `substance`
 *   - "none": it does not answer what was asked: "n/a", "-", "Nada por
 *     ahora", "Todo bien", only praise under "improvement", a pointer to
 *     another place; a "No" to a yes/no question that adds nothing.
 *   - "generic": it answers, but with a trait or an abstract area and no
 *     anchor: "Buen compañero", "Mejorar la comunicación", "Ser más
 *     proactivo".
 *   - "specific": it carries an anchor: a situation, an example, a number,
 *     a result, a project, an artifact or a clearly delimited action.
 * - `themes` (0-3): what the text is about, in the normalized keys; the
 *   "how" of the impact questions uses initiative types instead. A "none"
 *   text has no themes.
 * - `signals` (zero or more): what the text says about the person's
 *   situation, only when the text itself says it: "workload" (overload,
 *   burnout), "attrition" (intent or risk of leaving), "conflict" (with
 *   team, manager or client), "recognition" (feels unrecognised, pay),
 *   "stagnation" (no growth or challenge), "company_request" (asks the
 *   company for training, tools, resources or a role change), "role_fit"
 *   (mismatch with the role or the project).
 * - `tone`: "positive" (praise, satisfaction), "constructive" (names
 *   something to improve, learn or ask for, looking forward), "neutral"
 *   (factual, no valence), "mixed" (clear praise and clear concern in the
 *   same text), "negative" (mainly complaint, distress or discontent with
 *   no step forward). A text that proposes a step is constructive even when
 *   it names a problem.
 * - `yesNo` (the yes/no questions only): what the answer says; its `text` is
 *   the whole answer as typed, so it starts with "Sí", "Si", "Yes" or "No".
 *
 * A bare "Sí" / "No" is not in the bank (the generator writes those itself).
 * An answer under "social_impact" that tells an environmental initiative
 * (and the other way round) is on purpose: people answer in the wrong box.
 */

export const QUESTIONS = [
  "strengths",
  "improvement",
  "social_impact",
  "environmental_impact",
  "best_work_other",
] as const;
export type BankQuestion = (typeof QUESTIONS)[number];

export const SIDES = ["self", "manager"] as const;
export type BankSide = (typeof SIDES)[number];

export const LANGS = ["es", "en"] as const;
export type BankLang = (typeof LANGS)[number];

export const SUBSTANCES = ["none", "generic", "specific"] as const;
export type Substance = (typeof SUBSTANCES)[number];

export const SIGNALS = [
  "workload",
  "attrition",
  "conflict",
  "recognition",
  "stagnation",
  "company_request",
  "role_fit",
] as const;
export type Signal = (typeof SIGNALS)[number];

export const TONES = [
  "positive",
  "constructive",
  "neutral",
  "mixed",
  "negative",
] as const;
export type Tone = (typeof TONES)[number];

export const THEMES = [
  "proyecto",
  "equipo",
  "comunicacion",
  "crecimiento",
  "cultura",
  "procesos",
  "bienestar",
  "reconocimiento",
  "tecnica",
  "planificacion",
  "calidad",
  "liderazgo",
  "proactividad",
  "negocio",
  "aprendizaje",
  "documentacion",
] as const;
export type Theme = (typeof THEMES)[number];

/** The themes of the "how" of the social and environmental questions. */
export const INITIATIVES = [
  "voluntariado",
  "donaciones",
  "reciclaje",
  "consumo",
  "educacion",
  "movilidad",
] as const;
export type Initiative = (typeof INITIATIVES)[number];

export interface BankEntry {
  question: BankQuestion;
  side: BankSide;
  lang: BankLang;
  text: string;
  expected: {
    substance: Substance;
    themes: string[];
    signals: string[];
    tone: Tone;
    yesNo?: "yes" | "no";
  };
}

/** text, substance, themes, tone and (when there are any) signals. */
type Row = readonly [
  text: string,
  substance: Substance,
  themes: readonly (Theme | Initiative)[],
  tone: Tone,
  signals?: readonly Signal[],
];

const YES_NO_QUESTIONS: readonly BankQuestion[] = [
  "social_impact",
  "environmental_impact",
];

/** "yes" / "no" from how the answer starts (Sí, Si, Yes / No). */
function yesNoOf(text: string): "yes" | "no" {
  if (/^(s[ií]|yes)(?![\p{L}])/iu.test(text)) return "yes";
  if (/^no(?![\p{L}])/iu.test(text)) return "no";
  throw new Error(`A yes/no answer must start with a yes or a no: ${text}`);
}

function entries(
  question: BankQuestion,
  side: BankSide,
  lang: BankLang,
  rows: readonly Row[],
): BankEntry[] {
  return rows.map(([text, substance, themes, tone, signals = []]) => ({
    question,
    side,
    lang,
    text,
    expected: {
      substance,
      themes: [...themes],
      signals: [...signals],
      tone,
      ...(YES_NO_QUESTIONS.includes(question) ? { yesNo: yesNoOf(text) } : {}),
    },
  }));
}

// -- Strengths, employee (what do I do well?) -------------------------------

const STRENGTHS_SELF_ES: readonly Row[] = [
  [
    "Cuando algo se rompe en producción me quedo hasta encontrar la causa y dejo un post-mortem escrito.",
    "specific",
    ["calidad", "documentacion"],
    "positive",
  ],
  [
    "Armé la guía de onboarding del equipo y ya la usaron los últimos tres ingresos.",
    "specific",
    ["documentacion", "equipo"],
    "positive",
  ],
  [
    "Se me da bien traducir los pedidos del cliente en tareas claras para el equipo.",
    "specific",
    ["comunicacion", "negocio"],
    "positive",
  ],
  [
    "Este semestre automaticé el cierre mensual y pasamos de dos días a unas pocas horas.",
    "specific",
    ["procesos", "tecnica"],
    "positive",
  ],
  [
    "Hago las revisiones de código el mismo día y con comentarios que se pueden accionar.",
    "specific",
    ["calidad", "equipo"],
    "positive",
  ],
  [
    'Mi mejor trabajo fue el proyecto "Norte": entregamos a tiempo, sin retrabajo.',
    "specific",
    ["proyecto", "calidad", "planificacion"],
    "positive",
  ],
  [
    "Aprendí infraestructura como código en un mes y migré dos entornos sin cortes de servicio.",
    "specific",
    ["aprendizaje", "tecnica"],
    "positive",
  ],
  [
    "Doy charlas internas cada tanto; la última, sobre testing de integración, juntó a unas veinte personas.",
    "specific",
    ["aprendizaje", "equipo", "cultura"],
    "positive",
  ],
  [
    "Acompaño a los que recién entran: les armo un plan para las primeras dos semanas y les hago seguimiento.",
    "specific",
    ["equipo", "liderazgo"],
    "positive",
  ],
  [
    "Detecto riesgos a tiempo: en el proyecto Sur avisé del retraso del proveedor con tres semanas de anticipación.",
    "specific",
    ["planificacion", "proactividad"],
    "positive",
  ],
  [
    "Bajé los tiempos de respuesta de soporte de 24 a 8 horas ordenando la cola por prioridad.",
    "specific",
    ["procesos", "calidad"],
    "positive",
  ],
  [
    "Con Camila armamos el proceso de revisión de pedidos y hoy lo usan dos áreas.",
    "specific",
    ["procesos", "equipo"],
    "positive",
  ],
  [
    "Preparo los informes para dirección con los números ya validados, casi nunca vuelven con correcciones.",
    "specific",
    ["calidad", "negocio"],
    "positive",
  ],
  [
    "Me ocupo de la rotación de guardias y siempre dejo el traspaso documentado.",
    "specific",
    ["documentacion", "proactividad"],
    "positive",
  ],
  [
    "Negocié con el cliente un cambio de alcance que nos evitó dos semanas de trabajo extra.",
    "specific",
    ["negocio", "comunicacion"],
    "positive",
  ],
  [
    "Cumplo con lo que me piden y sigo aprendiendo, aunque este año pensé más de una vez en buscar algo nuevo.",
    "specific",
    ["crecimiento"],
    "mixed",
    ["attrition"],
  ],
  [
    "Mejoré el pipeline de despliegue: pasó de 40 a 12 minutos y ya nadie toca el servidor a mano.",
    "specific",
    ["tecnica", "procesos"],
    "positive",
  ],
  [
    "Cuando Martín se fue de vacaciones tomé su parte del proyecto Norte y la entrega no se atrasó.",
    "specific",
    ["proyecto", "equipo", "proactividad"],
    "positive",
  ],
  [
    "Aguanto bien la presión en los cierres, aunque últimamente vengo trabajando muchas horas de más.",
    "specific",
    ["bienestar"],
    "mixed",
    ["workload"],
  ],
  [
    "Me llevo bien con casi todos, menos con el equipo de QA: todavía discutimos cómo priorizar los bugs.",
    "specific",
    ["equipo", "calidad"],
    "mixed",
    ["conflict"],
  ],
  [
    "Estoy cubriendo tareas de soporte además de mi rol y las resuelvo, aunque no es lo que quería hacer.",
    "specific",
    ["proactividad"],
    "mixed",
    ["role_fit"],
  ],
  // generic
  ["Buena onda con el equipo.", "generic", ["equipo", "cultura"], "positive"],
  [
    "Soy constante y cumplo con lo que me comprometo.",
    "generic",
    ["proactividad"],
    "positive",
  ],
  [
    "Trabajo bien en equipo y ayudo a quien lo necesita.",
    "generic",
    ["equipo"],
    "positive",
  ],
  [
    "Aprendo rápido herramientas nuevas.",
    "generic",
    ["aprendizaje", "tecnica"],
    "positive",
  ],
  [
    "Tengo buena actitud y muchas ganas de aprender.",
    "generic",
    ["aprendizaje", "proactividad"],
    "positive",
  ],
  [
    "Creo que mi punto fuerte es la comunicación.",
    "generic",
    ["comunicacion"],
    "positive",
  ],
  ["Me adapto fácil a los cambios.", "generic", ["proactividad"], "positive"],
  ["Tengo buen nivel técnico.", "generic", ["tecnica"], "positive"],
  [
    "Me hago cargo de los problemas hasta resolverlos.",
    "generic",
    ["proactividad", "calidad"],
    "positive",
  ],
  [
    "Documento lo que hago, para que otros puedan continuar.",
    "generic",
    ["documentacion", "equipo"],
    "positive",
  ],
  // none
  ["-", "none", [], "neutral"],
  ["Nada en particular.", "none", [], "neutral"],
  ["No sé, mejor que lo diga mi líder.", "none", [], "neutral"],
];

const STRENGTHS_SELF_EN: readonly Row[] = [
  [
    "I rewrote the billing export last quarter; the month-end close now takes hours instead of two days.",
    "specific",
    ["procesos", "tecnica"],
    "positive",
  ],
  [
    "I send clients a short weekly note, so there are rarely surprises in the steering meetings.",
    "specific",
    ["comunicacion", "negocio"],
    "positive",
  ],
  [
    "I pair with newer teammates once a week and we go through real tickets together.",
    "specific",
    ["equipo", "aprendizaje"],
    "positive",
  ],
  [
    "Good team player and always willing to help.",
    "generic",
    ["equipo"],
    "positive",
  ],
  ["I am reliable and hard working.", "generic", ["proactividad"], "positive"],
  ["Strong communication skills.", "generic", ["comunicacion"], "positive"],
];

// -- Strengths, manager (what does the employee do well?) -------------------

const STRENGTHS_MANAGER_ES: readonly Row[] = [
  [
    "Tomó el proyecto Sur cuando se fue el líder anterior y lo sacó adelante sin perder la fecha.",
    "specific",
    ["proyecto", "liderazgo"],
    "positive",
  ],
  [
    'Su análisis del caso "Sur" cambió la decisión del comité.',
    "specific",
    ["negocio", "tecnica"],
    "positive",
  ],
  [
    "Documenta cada decisión técnica importante y eso nos ahorró varias discusiones repetidas.",
    "specific",
    ["documentacion", "tecnica"],
    "positive",
  ],
  [
    "Varios clientes piden que siga en sus cuentas; en la última encuesta lo mencionaron por su nombre.",
    "specific",
    ["negocio", "comunicacion"],
    "positive",
  ],
  [
    "Cuando entra un pedido urgente ordena las prioridades con el equipo en diez minutos y nadie queda trabado.",
    "specific",
    ["planificacion", "equipo"],
    "positive",
  ],
  [
    "Hizo de mentor de Julieta en sus primeros meses y hoy trabaja con total autonomía.",
    "specific",
    ["liderazgo", "aprendizaje", "equipo"],
    "positive",
  ],
  [
    "Redujo los bugs de regresión casi a la mitad escribiendo pruebas antes de tocar el módulo de pagos.",
    "specific",
    ["calidad", "tecnica"],
    "positive",
  ],
  [
    "Mantiene la calma en los incidentes: coordina, comunica el estado cada media hora y después arma el resumen.",
    "specific",
    ["liderazgo", "comunicacion", "procesos"],
    "positive",
  ],
  [
    "Aprendió el stack de datos en pocas semanas y hoy es la referencia cuando alguien tiene dudas.",
    "specific",
    ["aprendizaje", "tecnica"],
    "positive",
  ],
  [
    "Cumplió todos los hitos del plan de migración, incluso cuando el alcance cambió a mitad de camino.",
    "specific",
    ["planificacion", "proyecto"],
    "positive",
  ],
  [
    "Se anima a decir que no a pedidos que no suman y lo explica con datos.",
    "specific",
    ["negocio", "comunicacion"],
    "positive",
  ],
  [
    "Organizó la capacitación interna de seguridad y la asistencia fue casi total.",
    "specific",
    ["cultura", "aprendizaje"],
    "positive",
  ],
  [
    "En las reuniones con otras áreas llega con el tema preparado y cierra con acuerdos por escrito.",
    "specific",
    ["comunicacion", "procesos"],
    "positive",
  ],
  [
    "Recuperó la relación con un cliente complicado: escuchó, ordenó el backlog y en un mes volvió la confianza.",
    "specific",
    ["negocio", "comunicacion"],
    "positive",
  ],
  [
    "Entrega siempre con calidad y a tiempo; lo que hizo en el módulo de reportes este semestre fue muy sólido.",
    "specific",
    ["calidad", "planificacion", "proyecto"],
    "positive",
  ],
  [
    "Propuso el tablero de bloqueos en una retro y lo seguimos usando todo el semestre.",
    "specific",
    ["procesos", "proactividad"],
    "positive",
  ],
  [
    "Revisa los pull requests de los más nuevos con paciencia y explicando el porqué de cada cambio.",
    "specific",
    ["equipo", "calidad", "aprendizaje"],
    "positive",
  ],
  [
    "Trabaja muchísimas horas y rara vez avisa que está llegando al límite; hay que cuidarlo.",
    "specific",
    ["bienestar"],
    "mixed",
    ["workload"],
  ],
  [
    "Tiene muy buen nivel técnico, pero chocó varias veces con el equipo de producto por cómo se define el alcance.",
    "specific",
    ["tecnica", "equipo"],
    "mixed",
    ["conflict"],
  ],
  [
    "Es de lo mejor del equipo; me preocupa que lo estén buscando de afuera y no tenga un plan de carrera claro.",
    "specific",
    ["crecimiento"],
    "mixed",
    ["attrition"],
  ],
  [
    "Sostiene el soporte de tres sistemas viejos y casi nadie lo ve ni lo reconoce, pese a que sin eso se frena la operación.",
    "specific",
    ["reconocimiento", "procesos"],
    "mixed",
    ["recognition"],
  ],
  // generic
  [
    "Tiene muy buena actitud con el equipo y con clientes internos.",
    "generic",
    ["equipo", "cultura"],
    "positive",
  ],
  [
    "Es confiable: cuando dice que algo está, está.",
    "generic",
    ["proactividad"],
    "positive",
  ],
  [
    "Resuelve con autonomía y pide ayuda cuando corresponde.",
    "generic",
    ["proactividad"],
    "positive",
  ],
  [
    "Aporta ideas concretas en las retros.",
    "generic",
    ["proactividad", "equipo"],
    "positive",
  ],
  [
    "Es referente para los que recién ingresan.",
    "generic",
    ["equipo", "liderazgo"],
    "positive",
  ],
  [
    "Tiene mucha calidad en lo que entrega.",
    "generic",
    ["calidad"],
    "positive",
  ],
  [
    "Muy buena persona y muy buen trato.",
    "generic",
    ["cultura", "equipo"],
    "positive",
  ],
  ["Siempre con mucho compromiso.", "generic", ["proactividad"], "positive"],
  ["Su nivel técnico es muy bueno.", "generic", ["tecnica"], "positive"],
  ["Buena comunicación con todos.", "generic", ["comunicacion"], "positive"],
  // none
  ["N/A", "none", [], "neutral"],
  ["Todo bien.", "none", [], "positive"],
  ["Lo hablamos en la reunión de seguimiento.", "none", [], "neutral"],
];

const STRENGTHS_MANAGER_EN: readonly Row[] = [
  [
    "Took over the vendor integration mid-project and delivered it on the original date with no regressions.",
    "specific",
    ["proyecto", "tecnica", "proactividad"],
    "positive",
  ],
  [
    "Pairs with Sofía every week and has become the go-to person for the billing module.",
    "specific",
    ["equipo", "tecnica"],
    "positive",
  ],
  [
    "Handles tense client calls well: listens first, then proposes two options with trade-offs.",
    "specific",
    ["comunicacion", "negocio"],
    "positive",
  ],
  [
    "Great attitude and always helpful.",
    "generic",
    ["equipo", "cultura"],
    "positive",
  ],
  [
    "Very reliable and detail oriented.",
    "generic",
    ["calidad", "proactividad"],
    "positive",
  ],
  ["Strong technical skills.", "generic", ["tecnica"], "positive"],
];

// -- Improvement, employee (how could I improve?) ---------------------------

const IMPROVEMENT_SELF_ES: readonly Row[] = [
  [
    "Necesito dejar de resolver todo yo y delegar tareas puntuales, empezando por la revisión de la documentación.",
    "specific",
    ["liderazgo", "procesos"],
    "constructive",
  ],
  [
    "Estimo mal las tareas grandes: casi siempre me paso entre un 30 y un 50 %; quiero trabajar eso con datos de los sprints anteriores.",
    "specific",
    ["planificacion"],
    "constructive",
  ],
  [
    "Debería escribir más documentación; hoy buena parte de lo que sé está solo en mi cabeza y en el chat del equipo.",
    "specific",
    ["documentacion"],
    "constructive",
  ],
  [
    "Siento que mi perfil es más de análisis que de desarrollo; el rol actual me queda incómodo y rindo menos de lo que podría.",
    "specific",
    ["crecimiento", "tecnica"],
    "negative",
    ["role_fit"],
  ],
  [
    "Quiero mejorar mi inglés técnico para participar en las llamadas con el cliente sin trabarme.",
    "specific",
    ["aprendizaje", "comunicacion"],
    "constructive",
  ],
  [
    "Tengo que animarme a pedir ayuda antes: el mes pasado perdí dos días con algo que se resolvía con una pregunta.",
    "specific",
    ["proactividad", "comunicacion"],
    "constructive",
  ],
  [
    "Si no veo cambios en lo salarial en el próximo ciclo voy a empezar a mirar otras opciones.",
    "specific",
    ["reconocimiento"],
    "negative",
    ["attrition", "recognition"],
  ],
  [
    "Puedo presentar mejor los resultados: mis slides son muy técnicas y la gente de negocio se pierde.",
    "specific",
    ["comunicacion", "negocio"],
    "constructive",
  ],
  [
    "Necesito cuidar los tiempos de respuesta en el chat; a veces tardo medio día en contestar y eso traba a otros.",
    "specific",
    ["comunicacion", "equipo"],
    "constructive",
  ],
  [
    "Me gustaría tomar más ownership de la calidad del módulo de reportes; hoy espero a que QA encuentre los problemas.",
    "specific",
    ["calidad", "proactividad"],
    "constructive",
  ],
  [
    "Tengo que revisar mejor mi propio código antes de pedir revisión; me devolvieron varios PR por detalles evitables.",
    "specific",
    ["calidad", "tecnica"],
    "constructive",
  ],
  [
    "Tengo que mejorar la forma en que le doy feedback a Nicolás; a veces voy directo al error y lo desmotiva.",
    "specific",
    ["comunicacion", "equipo", "liderazgo"],
    "constructive",
  ],
  [
    "Quiero involucrarme más en las decisiones de producto, no solo ejecutar lo que baja de la planificación.",
    "specific",
    ["negocio", "proactividad"],
    "constructive",
  ],
  [
    "Estoy trabajando hasta tarde casi todos los días desde hace dos meses y necesito que se redistribuya parte de la carga.",
    "specific",
    ["bienestar", "planificacion"],
    "constructive",
    ["workload"],
  ],
  [
    "Me cuesta desconectar: contesto mails y mensajes de noche y los fines de semana, y ya empiezo a notar el cansancio.",
    "specific",
    ["bienestar"],
    "negative",
    ["workload"],
  ],
  [
    "Estoy evaluando otras ofertas porque no veo un camino de crecimiento claro acá en el próximo año.",
    "specific",
    ["crecimiento"],
    "negative",
    ["attrition", "stagnation"],
  ],
  [
    "Discuto seguido con el líder del proyecto por las prioridades y eso me desgasta; siento que no me escuchan.",
    "specific",
    ["liderazgo", "comunicacion", "equipo"],
    "negative",
    ["conflict"],
  ],
  [
    "Siento que mi trabajo no se ve: hace dos ciclos que no tengo revisión salarial y otros con menos carga sí la tuvieron.",
    "specific",
    ["reconocimiento"],
    "negative",
    ["recognition"],
  ],
  [
    "Hace meses hago siempre las mismas tareas de mantenimiento y no estoy aprendiendo nada nuevo.",
    "specific",
    ["crecimiento", "aprendizaje"],
    "negative",
    ["stagnation"],
  ],
  [
    "Necesito que la empresa me financie la certificación de cloud; sin eso no puedo tomar los proyectos de infraestructura.",
    "specific",
    ["aprendizaje", "crecimiento", "tecnica"],
    "constructive",
    ["company_request"],
  ],
  [
    "Me pasaron a coordinar el proyecto, pero lo mío es programar; me gustaría volver a un rol técnico.",
    "specific",
    ["liderazgo", "tecnica"],
    "constructive",
    ["role_fit", "company_request"],
  ],
  // generic
  [
    "Me gustaría animarme a liderar reuniones.",
    "generic",
    ["liderazgo", "proactividad"],
    "constructive",
  ],
  [
    "Puedo ser más proactivo pidiendo feedback.",
    "generic",
    ["proactividad", "comunicacion"],
    "constructive",
  ],
  [
    "Necesito mejorar la planificación de mis tiempos.",
    "generic",
    ["planificacion"],
    "constructive",
  ],
  [
    "Quiero delegar más y no cargar con todo.",
    "generic",
    ["liderazgo", "planificacion"],
    "constructive",
  ],
  [
    "Tengo que priorizar mejor cuando llegan varios pedidos a la vez.",
    "generic",
    ["planificacion"],
    "constructive",
  ],
  [
    "Quiero profundizar en el área técnica,\ny a la vez entender mejor el negocio.",
    "generic",
    ["tecnica", "negocio"],
    "constructive",
  ],
  ["Mejorar la comunicación.", "generic", ["comunicacion"], "constructive"],
  ["Tengo que seguir aprendiendo.", "generic", ["aprendizaje"], "constructive"],
  [
    "Siento que falta reconocimiento.",
    "generic",
    ["reconocimiento"],
    "negative",
    ["recognition"],
  ],
  [
    "Me gustaría que la empresa ofrezca más capacitaciones.",
    "generic",
    ["aprendizaje", "crecimiento"],
    "constructive",
    ["company_request"],
  ],
  // none
  ["Nada por ahora.", "none", [], "neutral"],
  ["Ninguna.", "none", [], "neutral"],
  ["Todo bien, no se me ocurre nada.", "none", [], "positive"],
];

const IMPROVEMENT_SELF_EN: readonly Row[] = [
  [
    "I should write decisions down in the wiki; right now most of the context lives in chat threads and gets lost.",
    "specific",
    ["documentacion", "comunicacion"],
    "constructive",
  ],
  [
    "I want to get better at estimating: I underestimated the reporting module by almost two weeks.",
    "specific",
    ["planificacion"],
    "constructive",
  ],
  [
    "I have been on the same maintenance tickets for months and would like a chance to work on something new.",
    "specific",
    ["crecimiento", "aprendizaje"],
    "constructive",
    ["stagnation"],
  ],
  [
    "Communicate more proactively.",
    "generic",
    ["comunicacion", "proactividad"],
    "constructive",
  ],
  [
    "I need to improve my time management.",
    "generic",
    ["planificacion"],
    "constructive",
  ],
  ["More technical depth.", "generic", ["tecnica"], "constructive"],
];

// -- Improvement, manager (how could the employee improve?) -----------------

const IMPROVEMENT_MANAGER_ES: readonly Row[] = [
  [
    "En el proyecto Sur nos enteramos del atraso cuando ya no había margen; necesito que avise apenas vea una desviación.",
    "specific",
    ["planificacion", "comunicacion"],
    "constructive",
  ],
  [
    "Varios resultados buenos de este semestre no llegaron a la dirección; sugiero que arme un resumen mensual.",
    "specific",
    ["comunicacion", "reconocimiento"],
    "constructive",
  ],
  [
    "Espera a que le asignen los temas; me gustaría que proponga y lidere al menos una iniciativa transversal por semestre.",
    "specific",
    ["proactividad", "liderazgo"],
    "constructive",
  ],
  [
    "Delega poco: todas las revisiones de los juniors pasan por su escritorio y se volvió un cuello de botella.",
    "specific",
    ["liderazgo", "procesos"],
    "constructive",
  ],
  [
    "En las reuniones con otras áreas suele llegar sin el tema preparado y se pierde media hora en poner contexto.",
    "specific",
    ["comunicacion", "planificacion"],
    "constructive",
  ],
  [
    "Sus estimaciones suelen quedar cortas en las tareas de integración; conviene que las revise con alguien del equipo antes de comprometerse.",
    "specific",
    ["planificacion", "tecnica"],
    "constructive",
  ],
  [
    "Escribe poca documentación: cuando estuvo de vacaciones nadie sabía cómo correr el proceso de cierre.",
    "specific",
    ["documentacion", "procesos"],
    "constructive",
  ],
  [
    "Dijo en el último 1:1 que está escuchando propuestas de afuera; hay que conversar qué lo haría quedarse.",
    "specific",
    ["crecimiento"],
    "constructive",
    ["attrition"],
  ],
  [
    "Puede profundizar en pruebas automatizadas: el 70 % de sus cambios todavía se validan a mano.",
    "specific",
    ["calidad", "tecnica"],
    "constructive",
  ],
  [
    "Me gustaría que dé el salto a liderar una squad chica el próximo semestre; tiene las condiciones.",
    "specific",
    ["liderazgo", "crecimiento"],
    "constructive",
  ],
  [
    "Prioriza bien lo urgente, pero deja de lado la mejora continua: el backlog técnico creció todo este semestre.",
    "specific",
    ["planificacion", "calidad"],
    "constructive",
  ],
  [
    "Cuando hay desacuerdos prefiere callar en la reunión y después lo comenta por privado; conviene que lo diga en el momento.",
    "specific",
    ["comunicacion", "equipo", "cultura"],
    "constructive",
  ],
  [
    "Con Facundo discutieron varias veces por cómo dividir las tareas del sprint; conviene acordar reglas antes de arrancar.",
    "specific",
    ["equipo", "comunicacion", "planificacion"],
    "constructive",
    ["conflict"],
  ],
  [
    "Está tomando más de lo que puede: trabaja de noche y los fines de semana y no lo dice. Hay que redistribuir su carga.",
    "specific",
    ["bienestar", "planificacion"],
    "constructive",
    ["workload"],
  ],
  [
    "Se comprometió con tres frentes a la vez y empezó a mostrar agotamiento: errores de distracción y menos participación en la daily. Conviene bajarle un frente.",
    "specific",
    ["bienestar", "planificacion"],
    "constructive",
    ["workload"],
  ],
  [
    "Me preocupa que se vaya: recibió una propuesta de otra empresa y hoy no tiene un plan de carrera claro con nosotros.",
    "specific",
    ["crecimiento"],
    "negative",
    ["attrition"],
  ],
  [
    "Tiene fricciones recurrentes con el equipo de producto por los plazos; en dos reuniones terminaron discutiendo y hubo que mediar.",
    "specific",
    ["equipo", "comunicacion"],
    "negative",
    ["conflict"],
  ],
  [
    "Su sueldo quedó por debajo de la banda del puesto y es un tema que viene planteando; hay que corregirlo en la próxima revisión salarial.",
    "specific",
    ["reconocimiento"],
    "constructive",
    ["recognition"],
  ],
  [
    "Lleva más de un año en el mismo tipo de tareas y se nota que perdió desafío; necesita un proyecto más exigente.",
    "specific",
    ["crecimiento", "proyecto"],
    "constructive",
    ["stagnation"],
  ],
  [
    "Necesita una capacitación formal en seguridad cloud; hay que conseguirle presupuesto antes del próximo ciclo.",
    "specific",
    ["aprendizaje", "tecnica"],
    "constructive",
    ["company_request"],
  ],
  [
    "Su perfil encaja más con un rol de análisis que con el de soporte que ocupa hoy; deberíamos conversar un cambio de rol.",
    "specific",
    ["crecimiento", "negocio"],
    "constructive",
    ["role_fit", "company_request"],
  ],
  // generic
  [
    "Puede anticipar más los riesgos y avisar antes.",
    "generic",
    ["planificacion", "comunicacion"],
    "constructive",
  ],
  [
    "Le sugiero comunicar más hacia arriba lo que logra.",
    "generic",
    ["comunicacion", "reconocimiento"],
    "constructive",
  ],
  [
    "Debería tomar más ownership de proyectos transversales.",
    "generic",
    ["proactividad", "liderazgo"],
    "constructive",
  ],
  [
    "Tiene que cuidar los tiempos de respuesta en reuniones con otras áreas.",
    "generic",
    ["comunicacion", "equipo"],
    "constructive",
  ],
  [
    "Puede ganar visibilidad compartiendo sus aprendizajes con el resto del equipo.",
    "generic",
    ["comunicacion", "aprendizaje"],
    "constructive",
  ],
  [
    "Sería bueno trabajar la delegación, y a la vez el seguimiento.",
    "generic",
    ["liderazgo", "proactividad"],
    "constructive",
  ],
  [
    "Le falta un poco de proactividad.",
    "generic",
    ["proactividad"],
    "constructive",
  ],
  ["Mejorar la planificación.", "generic", ["planificacion"], "constructive"],
  [
    "Necesita más experiencia técnica.",
    "generic",
    ["tecnica", "crecimiento"],
    "constructive",
  ],
  [
    "Podríamos reconocerle más el trabajo que hace.",
    "generic",
    ["reconocimiento"],
    "constructive",
    ["recognition"],
  ],
  // none
  ["No aplica.", "none", [], "neutral"],
  ["Sin comentarios.", "none", [], "neutral"],
  ["Es excelente, no cambiaría nada.", "none", [], "positive"],
];

const IMPROVEMENT_MANAGER_EN: readonly Row[] = [
  [
    "Needs to flag risks earlier: on the Sur project we only learned about the delay two days before the deadline.",
    "specific",
    ["planificacion", "comunicacion"],
    "constructive",
  ],
  [
    "Could share what they learn more often, for example by presenting the cloud course notes to the team.",
    "specific",
    ["aprendizaje", "equipo"],
    "constructive",
  ],
  [
    "Has been struggling with the workload since the reorg; I would take one of the two client accounts off their plate.",
    "specific",
    ["bienestar", "planificacion"],
    "constructive",
    ["workload"],
  ],
  ["Could be more proactive.", "generic", ["proactividad"], "constructive"],
  [
    "Needs to improve time estimation.",
    "generic",
    ["planificacion"],
    "constructive",
  ],
  [
    "More visibility with stakeholders.",
    "generic",
    ["comunicacion", "reconocimiento"],
    "constructive",
  ],
];

// -- Social impact, how (yes/no and how) ------------------------------------

const SOCIAL_ES: readonly Row[] = [
  [
    "Sí, participé en la campaña de donaciones de fin de año.",
    "specific",
    ["donaciones"],
    "positive",
  ],
  [
    "Sí, con el voluntariado de la escuela del barrio.",
    "specific",
    ["voluntariado", "educacion"],
    "positive",
  ],
  [
    "Sí, doy clases de programación una vez por semana en un centro comunitario.",
    "specific",
    ["educacion", "voluntariado"],
    "positive",
  ],
  [
    "Sí, organicé la colecta de útiles escolares del año pasado y juntamos más de 80 kits.",
    "specific",
    ["donaciones", "educacion"],
    "positive",
  ],
  [
    "Sí, soy mentor en el programa de becas para estudiantes de Sistemas.",
    "specific",
    ["educacion"],
    "positive",
  ],
  [
    "Sí, con el equipo cocinamos en un comedor comunitario una vez cada dos meses.",
    "specific",
    ["voluntariado"],
    "positive",
  ],
  [
    "Sí, aporto todos los meses a la fundación que apoya la empresa y ayudé en la feria de ropa.",
    "specific",
    ["donaciones"],
    "positive",
  ],
  [
    "Sí, ayudé a armar el sitio web de una ONG de adopción de mascotas, de forma voluntaria.",
    "specific",
    ["voluntariado"],
    "positive",
  ],
  [
    "Sí, fui jurado de la hackatón para escuelas técnicas y después seguí a dos equipos.",
    "specific",
    ["educacion", "voluntariado"],
    "positive",
  ],
  [
    "Sí, doné sangre en la jornada con el hospital y sumé a tres compañeros.",
    "specific",
    ["donaciones", "voluntariado"],
    "positive",
  ],
  // an environmental initiative under the social question
  [
    "Sí, participé de la jornada de reciclaje de electrónicos y plantamos árboles en la plaza.",
    "specific",
    ["reciclaje", "voluntariado"],
    "positive",
  ],
  [
    "Sí, vengo en bici a la oficina y ayudé a armar el bicicletero.",
    "specific",
    ["movilidad"],
    "positive",
  ],
  // generic
  [
    "Sí, colaboro cuando se organiza algo en la empresa.",
    "generic",
    [],
    "positive",
  ],
  [
    "Sí, participo en las actividades que propone la empresa.",
    "generic",
    [],
    "positive",
  ],
  ["Sí, con voluntariado.", "generic", ["voluntariado"], "positive"],
  ["Si, con donaciones.", "generic", ["donaciones"], "positive"],
  ["Sí, de a ratos, cuando mis tiempos lo permiten.", "generic", [], "neutral"],
  [
    "Sí, aunque me gustaría que la empresa organice más actividades.",
    "generic",
    [],
    "constructive",
    ["company_request"],
  ],
  // none
  ["No por ahora.", "none", [], "neutral"],
  ["No, este semestre no pude sumarme a ninguna.", "none", [], "neutral"],
];

const SOCIAL_EN: readonly Row[] = [
  [
    "Yes, I volunteer on Saturdays at a local coding school for teenagers.",
    "specific",
    ["voluntariado", "educacion"],
    "positive",
  ],
  [
    "Yes, I helped organise the winter clothes drive and we collected around 200 items.",
    "specific",
    ["donaciones", "voluntariado"],
    "positive",
  ],
  [
    "Yes, I join the volunteering activities.",
    "generic",
    ["voluntariado"],
    "positive",
  ],
  ["Yes, whenever the company asks for help.", "generic", [], "positive"],
];

// -- Environmental impact, how (yes/no and how) -----------------------------

const ENVIRONMENTAL_ES: readonly Row[] = [
  [
    "Si, separando residuos y reduciendo impresiones.",
    "specific",
    ["reciclaje", "consumo"],
    "positive",
  ],
  [
    "Sí, llevo las pilas y los electrónicos viejos al punto de reciclaje de la oficina.",
    "specific",
    ["reciclaje"],
    "positive",
  ],
  [
    "Sí, vengo en bici o en tren y no uso el auto para ir a la oficina.",
    "specific",
    ["movilidad"],
    "positive",
  ],
  [
    "Sí, impulsé que dejemos de usar vasos descartables en la cocina; ya los reemplazamos por tazas.",
    "specific",
    ["consumo", "reciclaje"],
    "positive",
  ],
  [
    "Sí, armé la compostera de la terraza con otras dos personas.",
    "specific",
    ["reciclaje"],
    "positive",
  ],
  [
    "Sí, apago equipos y luces al irme y propuse configurar el ahorro de energía en las notebooks.",
    "specific",
    ["consumo"],
    "positive",
  ],
  [
    "Sí, participé en la jornada de plantación de árboles en la reserva y en la limpieza del río.",
    "specific",
    ["voluntariado"],
    "positive",
  ],
  [
    "Sí, en casa y en la oficina: separo, uso botella reutilizable y evito el plástico de un solo uso.",
    "specific",
    ["reciclaje", "consumo"],
    "positive",
  ],
  [
    "Sí, di una charla de concientización sobre huella de carbono en el almuerzo mensual.",
    "specific",
    ["educacion"],
    "positive",
  ],
  [
    "Sí, propuse el carpooling para la jornada de equipo y fuimos cuatro autos en vez de nueve.",
    "specific",
    ["movilidad"],
    "positive",
  ],
  // a social initiative under the environmental question
  [
    "Sí, doné ropa y libros para la feria solidaria de la fundación.",
    "specific",
    ["donaciones"],
    "positive",
  ],
  [
    "Sí, reduje las impresiones casi a cero: todo va en digital y reutilizo el papel de borrador.",
    "specific",
    ["consumo", "reciclaje"],
    "positive",
  ],
  // generic
  ["Sí, cuido el consumo de energía.", "generic", ["consumo"], "positive"],
  ["Sí, reciclo.", "generic", ["reciclaje"], "positive"],
  ["Sí, en lo que puedo.", "generic", [], "neutral"],
  ["Sí, participo en las campañas de la empresa.", "generic", [], "positive"],
  ["Si, con pequeñas cosas del día a día.", "generic", [], "positive"],
  [
    "Sí, pero la empresa podría hacer bastante más en reciclaje.",
    "generic",
    ["reciclaje"],
    "constructive",
    ["company_request"],
  ],
  // none
  ["No, todavía no.", "none", [], "neutral"],
  ["No me enteré de ninguna iniciativa este semestre.", "none", [], "neutral"],
];

const ENVIRONMENTAL_EN: readonly Row[] = [
  [
    "Yes, I cycle to the office three days a week and I started the recycling corner on our floor.",
    "specific",
    ["movilidad", "reciclaje"],
    "positive",
  ],
  [
    "Yes, I proposed we stop printing the weekly reports; we saved around 2,000 pages a month.",
    "specific",
    ["consumo"],
    "positive",
  ],
  [
    "Yes, I try to recycle and save energy.",
    "generic",
    ["reciclaje", "consumo"],
    "positive",
  ],
  ["Yes, small things.", "generic", [], "neutral"],
];

// -- Best work, "Other" text (what would help me do my best work?) ----------

const BEST_WORK_OTHER_ES: readonly Row[] = [
  [
    "Tener un entorno de pruebas propio: hoy compartimos staging con tres equipos y pierdo casi un día por semana esperando que se libere.",
    "specific",
    ["tecnica", "procesos"],
    "constructive",
    ["company_request"],
  ],
  [
    "Que los pedidos lleguen con criterios de aceptación claros; la mitad de mi retrabajo viene de requisitos ambiguos.",
    "specific",
    ["procesos", "comunicacion", "calidad"],
    "constructive",
  ],
  [
    "Bloques de dos horas sin reuniones por la mañana para poder concentrarme en el desarrollo.",
    "specific",
    ["procesos", "bienestar"],
    "constructive",
  ],
  [
    "Que los builds no tarden tanto: compilar el proyecto lleva 25 minutos y pierdo el foco cada vez.",
    "specific",
    ["tecnica", "procesos"],
    "constructive",
  ],
  [
    "Poder rotar a un proyecto de datos al menos un trimestre; hace dos años que estoy en el mismo producto.",
    "specific",
    ["crecimiento", "aprendizaje"],
    "constructive",
    ["company_request", "stagnation"],
  ],
  [
    "Poder pairear con gente senior, sobre todo en los primeros meses de un proyecto nuevo.",
    "specific",
    ["aprendizaje", "equipo"],
    "constructive",
  ],
  [
    "Que el cliente defina un único referente: hoy recibimos pedidos contradictorios de tres personas distintas.",
    "specific",
    ["comunicacion", "negocio", "proyecto"],
    "constructive",
  ],
  [
    "Que se respeten los horarios: hay reuniones de equipo a las 18:30 y a veces nos quedamos hasta las 20.",
    "specific",
    ["bienestar", "procesos"],
    "constructive",
    ["workload"],
  ],
  [
    "Un plan de carrera por escrito, con criterios claros para pasar de semi senior a senior.",
    "specific",
    ["crecimiento"],
    "constructive",
    ["company_request"],
  ],
  [
    "Documentación actualizada del módulo de facturación; la que existe quedó de hace tres versiones.",
    "specific",
    ["documentacion", "calidad"],
    "constructive",
  ],
  [
    "Trabajar con la misma gente más de un trimestre seguido; cada reorganización nos hace empezar de cero.",
    "specific",
    ["equipo", "planificacion", "cultura"],
    "constructive",
  ],
  [
    "Estar en un rol más cercano al desarrollo: hoy el 80 % de mi día son tareas de soporte y gestión de tickets.",
    "specific",
    ["tecnica", "crecimiento"],
    "constructive",
    ["role_fit"],
  ],
  // generic
  [
    "Más tiempo para capacitarme.",
    "generic",
    ["aprendizaje", "crecimiento"],
    "constructive",
    ["company_request"],
  ],
  ["Menos reuniones y más foco.", "generic", ["procesos"], "constructive"],
  [
    "Más claridad en las prioridades.",
    "generic",
    ["planificacion", "comunicacion"],
    "constructive",
  ],
  ["Más autonomía.", "generic", ["proactividad", "liderazgo"], "constructive"],
  [
    "Mejor comunicación entre áreas.",
    "generic",
    ["comunicacion", "procesos"],
    "constructive",
  ],
  [
    "Mejores herramientas de trabajo.",
    "generic",
    ["tecnica"],
    "constructive",
    ["company_request"],
  ],
  // none
  ["Ninguno en particular.", "none", [], "neutral"],
  ["No sé, depende del proyecto.", "none", [], "neutral"],
];

const BEST_WORK_OTHER_EN: readonly Row[] = [
  [
    "Clearer acceptance criteria on tickets; most of my rework comes from ambiguous requirements.",
    "specific",
    ["procesos", "comunicacion", "calidad"],
    "constructive",
  ],
  [
    "Fewer context switches: I support two products at once and lose a lot of time moving between them.",
    "specific",
    ["planificacion", "procesos"],
    "constructive",
  ],
  [
    "Clearer priorities.",
    "generic",
    ["planificacion", "comunicacion"],
    "constructive",
  ],
  ["Fewer meetings.", "generic", ["procesos"], "constructive"],
];

/** Every text of the bank with its expected reading. */
export const TEXT_BANK: readonly BankEntry[] = [
  ...entries("strengths", "self", "es", STRENGTHS_SELF_ES),
  ...entries("strengths", "self", "en", STRENGTHS_SELF_EN),
  ...entries("strengths", "manager", "es", STRENGTHS_MANAGER_ES),
  ...entries("strengths", "manager", "en", STRENGTHS_MANAGER_EN),
  ...entries("improvement", "self", "es", IMPROVEMENT_SELF_ES),
  ...entries("improvement", "self", "en", IMPROVEMENT_SELF_EN),
  ...entries("improvement", "manager", "es", IMPROVEMENT_MANAGER_ES),
  ...entries("improvement", "manager", "en", IMPROVEMENT_MANAGER_EN),
  ...entries("social_impact", "self", "es", SOCIAL_ES),
  ...entries("social_impact", "self", "en", SOCIAL_EN),
  ...entries("environmental_impact", "self", "es", ENVIRONMENTAL_ES),
  ...entries("environmental_impact", "self", "en", ENVIRONMENTAL_EN),
  ...entries("best_work_other", "self", "es", BEST_WORK_OTHER_ES),
  ...entries("best_work_other", "self", "en", BEST_WORK_OTHER_EN),
];
