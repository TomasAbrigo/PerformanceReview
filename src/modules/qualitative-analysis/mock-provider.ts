import type { Sentiment, Signal, Substance } from "./constants";
import { fold } from "./dimension";
import type {
  AnalysisInput,
  AnalysisOutput,
  AnalysisProvider,
} from "./provider";
import { isImpactQuestion } from "./themes";

/**
 * Lexical cues, matched on the squashed text (lowercase, no accents, no
 * punctuation, padded with spaces) at the start of a word: "proactiv" hits
 * "proactivo" but never "improactivo"; a cue that ends in a space is a whole
 * word ("bien " is not "bienestar"). A cue starting with "+" counts double.
 * Lists are written as one string, cues separated by "|".
 */
type Cue = readonly [cue: string, weight: number];
const cues = (list: string): Cue[] =>
  list
    .split("|")
    .map((c) => (c.startsWith("+") ? ([c.slice(1), 2] as const) : [c, 1]));
const table = (rec: Record<string, string>) =>
  Object.entries(rec).map(([k, list]) => [k, cues(list)] as const);

// -- Tone ---------------------------------------------------------------------

/** Praise: satisfaction, a quality of the person or of the work. */
const PRAISE = cues(
  "bien |buen|muy buen|excelente|gran |lo mejor|destac|referente|confiab|solid|rapid|sobresalient|fuerte|talent|habil|constan|compromet|autonom|responsab|adapt|resuelv|impulso|aporta|ayud|agradabl|paciencia|siempre |a tiempo|con calidad|reconocid|me siento valorad|me siento muy valorad|me gusta|orgullos|contento|satisfech|feliz|" +
    "good |well |great |strong|reliable|helpful|excellent|outstanding|quick|always |hard working|hardworking|detail oriented|skilled|talented|proud|happy|enjoy|feel valued|feel highly valued|recogni",
);

/**
 * The work-action verbs of a strength ("armé", "documento", "redujo"): what a
 * person says they do. In a strengths answer they carry the praise when no
 * adjective does.
 */
const ACTION = cues(
  "arm|automatiz|automatic|redu|organiz|prepar|detect|document|negoci|propus|propon|escrib|acompan|entreg|cumpl|logr|mejore |mejoro |mejoramos|lider|guie|guio|dise|implement|migr|optimiz|ensen|coordin|revis|ordena|cierr|ocup|hago|hace|hizo|doy|dio|dejo|traduc|recuper|evit|ahorr|cambi|tomo|avis|resolv|crea|cree|gener|analiz|gestion|particip|compart|explic|escuch|atend|respond|contest|" +
    "wrote|rewrote|built|led |send|sent |handle|propos|review|help|reduc|deliver|mentor|teach|automate|migrate|design|creat|listen|coordinat|ship|fixed|solv|organis|improv",
);

/** Concern: a complaint, distress, friction, a caveat about the person. */
const CONCERN = cues(
  "discut|choc|friccion|cansanci|me desgasta|no me escuchan|nadie lo ve|no se ve|incomod|no cumple|llega tarde|llego tarde|es un problema|fue un problema|entrega tarde|retrabajo|conflict|queja|desorganiz|frustr|desmotiv|estres|burnout|agotad|agotamiento|maltrato|no me siento|falta de|preocup|aunque|todavia|no es lo que|" +
    "poor|missed|lack of|complain|dont feel|do not feel|not valued|although|worried|struggl|overwhelm|frustrat|unhappy|tension|sobrecarg|estancad|otras ofertas|otras opciones|otra empresa|perdio desafio",
);

/** "pero" and friends: a caveat after praise. */
const CONTRAST = cues("pero |but |however|sin embargo|menos con");

/**
 * A step forward: an obligation, a wish, a suggestion, a request. A text with
 * one is constructive even when it names a problem.
 */
const STEP = cues(
  "tengo que|tiene que|tenemos que|hay que|debo |debe |deberia|necesit|quiero|quisiera|queremos|me gustaria|sugiero|sugerir|recomiend|conviene|convendria|seria bueno|seria util|puedo |puede |podria|propongo|mejorar|profundizar|desarrollar|animarme|empezar a|dar el salto|trabajar en|" +
    "should|need|want to|would |could|improve|work on|get better|better at|suggest|recommend|i wish",
);

/**
 * Weaker step cues: in an improvement or an open answer a comparative is a
 * request ("más tiempo", "mejores herramientas", "clearer").
 */
const REQUEST = cues(
  "mas |menos |mayor |mejor |mejores |mejora |claridad|clearer|fewer |less |more |better |faster ",
);

/**
 * The openers of a wish ("Que los pedidos lleguen…", "Poder rotar…", "Un plan
 * de carrera…", "Fewer meetings"): what would help me, answered as a noun
 * phrase or an infinitive. Matched at the start of the answer.
 */
const OPENERS =
  /^(que |poder |tener |estar |contar con |un |una |unos |unas |mas |menos |mejor |mejores |mayor |more |less |fewer |clearer |better |a |an |access |time |having |to have |be able |being )/;

/**
 * A shortfall named about someone: what an improvement answer points at when
 * it has no explicit wish ("poca documentación", "suele llegar sin…").
 */
const GAP = cues(
  "poca |poco |pocas |pocos |suele |a veces|casi siempre me|deja de|se pierde|tardo|tarda|demora|mal |falta|faltan|no llegaron|nadie sabia|subestim|underestimat|late |rarely|sin |cuando estuvo",
);

// -- Themes -------------------------------------------------------------------

/** Theme key -> cues. Order breaks ties (People's eight first). */
const THEMES = table({
  proyecto:
    "proyecto|project|alcance|scope|entregable|deliverable|hito|milestone|entrega|delivery|deliver|lanzamiento|release|roadmap|implementacion|migracion|feature|funcionalidad|sprint",
  equipo:
    "equipo|team|companer|colega|colabor|teammate|collaborat|squad|pair|grupo|group|gente|personas|people|everyone|recien entra|recien ingres|onboarding|apoy|newcomer|colaborativ|empati|empathy|buen companero|supportive|friendly|agradable|approachable|humilde|humble|compania|ayuda a|helps",
  comunicacion:
    "+comunic|+communicat|+feedback|escuch|listen|dialogo|transparen|reunion|meeting|mail|chat|slack|avis|informa|present|expectativ|claridad|clarity|clearer|claros|claras|clearly|requisit|acuerdo|explic|explain|stakeholder|visib|slides|contest|respuesta|response|ambigu|conversar|hablar|mensaje|comentar|preguntar|traduc|mediar|alinear|align|actualiz|negoci|comunicativ|communicator|articulate|asertiv|assertive|transmit|expone|exposicion|presentaciones|presentation",
  crecimiento:
    "+crecer|+crecim|+growth|+carrera|+career|ascenso|promocion|promotion|rol |role|salto|desafio|challenge|reto|rotar|rotation|senior|seniority|proximo paso|next step|futuro|future|oportunidad|opportunit|estanc|certific|capacit",
  cultura:
    "+cultura|+culture|valores|values|clima|inclusi|diversi|actitud|attitude|charla|talks|ambiente|interna|internas|interno|evento|celebr|respeto|respect|confianza|trust|etica|ethic|positiv|buena onda|positiva|positive attitude|energia|humor|culture fit|buen clima|ambiente de trabajo|work environment|friendly",
  procesos:
    "+proceso|+process|metodolog|procedimiento|burocr|workflow|automatiz|automatic|automate|pipeline|despliegue|tablero|board|flujo|flow|ticket|criterios|acceptance|ceremonia|agile|scrum|kanban|estandar|standard|plantilla|template|checklist|rutina|routine|eficien|efficien|operativ|mejora continua|continuous improvement",
  bienestar:
    "+bienestar|+wellbeing|well being|estres|stress|burnout|carga de trabajo|workload|salud|health|descanso|rest |desconect|disconnect|cansanci|tired|fatigue|agotamiento|agotad|exhaust|fines de semana|weekend|de noche|horario|equilibrio|balance|sobrecarg|overload|overtime|struggl|vacacion|vacation|ansiedad|anxiety|presion|pressure|flexib|home office|horas extra",
  reconocimiento:
    "+reconoc|+recogni|valorad|valued|aprecia|agradec|thank|salarial|sueldo|salario|salary|compensa|aumento|raise|bono|bonus|banda del puesto|visibilidad|visibility|mencion|premio|award|credit|merito|merit|valioso|valuable|indispensable|key person|pieza clave",
  tecnica:
    "+tecnic|+technical|codigo|code|coding|arquitect|architecture|testing|test|prueba|bug|infraestructura|infrastructure|cloud|aws|servidor|server|staging|entorno|environment|pull request|pipeline|despliegue|deploy|devops|automat|seguridad|security|desarrollo|software|herramienta|tool|base de datos|database|api |backend|frontend|datos|data |refactor|deuda tecnica|performance|escalab|scalab|monitor|integracion|integration|sistemas|stack|framework|python|java|git |skills|expert|expertise|hands on|analitic|analytic|resolucion de problemas|debug|troubleshoot|conocimiento tecnico|domain knowledge|ingenier|engineer|programacion|programming",
  planificacion:
    "+planific|+prioriz|+prioridad|+priorit|planning|deadline|plazo|fecha|date|estimac|estimat|estimo|estimating|tiempos|timing|time management|cronograma|schedule|roadmap|sprint|backlog|capacidad|capacity|riesgo|risk|retraso|delay|atraso|anticipacion|a tiempo|on time|agenda|foco|focus|plan de trabajo|plan de accion|work plan|hitos|milestones|seguimiento|follow up|tracking|punctual|organized|organised|organizacion|organization|orden |ordenar|gestion del tiempo|prioritiz|deadlines|plazos",
  calidad:
    "+calidad|+quality|retrabajo|rework|prolij|detalle|detail|regresion|error|mistake|correccion|correction|validad|validation|revision|review|causa raiz|root cause|post mortem|postmortem|bug|defect|defecto|falla|incidente|incident|cobertura|coverage|pruebas|rigor|cuidado|precis|accura|robust|estable|stable|arregl|corrig|detallista|ordenad|meticul|cuidados|thorough|careful|attention to detail|orientad a detalles|exigente|bien hecho|well done",
  liderazgo:
    "+lider|+lead|+deleg|+mentor|guiar|guide |referente|squad|ownership|coach|inspir|toma de decisiones|decision making|autoridad|manager|jefe|gestion de personas|people management|dirigir|coordin|a cargo|in charge|recien entra|inspir|model a seguir|role model|leader|dirige|guia a|guides|lidera",
  proactividad:
    "+proactiv|+anticip|+iniciativa|+initiative|+ownership|hago cargo|me ocupo|me encargo|propus|propon|propos|avis|detect|constan|confiab|reliab|adapt|autonom|compromet|cumpl|hard work|involucr|animarme|ganas|dispuesto|willing|motiv|esfuerzo|effort|disciplin|responsab|responsib|resilien|dedic|extra mile|resuelve|solves|problem solving|responsable|puntual|comprometid|resolutiv|dedicad|perseveran|esforz|dependable|committed|responsible|self motivated|driven|resourceful|flexible|adaptab|gets things done|takes ownership|trabajador|hard working|persisten",
  negocio:
    "+negocio|+cliente|+business|+customer|client|stakeholder|direccion|producto|product|comite|presupuesto|budget|kpi|venta|sales|revenue|mercado|market|usuario|user|costo|cost |impacto en el negocio|comercial|commercial|client facing|orientad al cliente|customer focused|vision de negocio|propuesta de valor|value proposition",
  aprendizaje:
    "+aprend|+profundiz|+capacit|+learn|curso|course|certific|formacion|training|mentor|pairear|pairing|conocimiento|knowledge|estudi|study|taller|workshop|curios|skill|habilidad|upskill|conferencia|conference|bootcamp|curios|quick learner|aprende rapido|learns fast|willing to learn|growth mindset|aprender",
  documentacion:
    "+document|wiki|guia de|post mortem|por escrito|escrito|written|write down|traspaso|handover|hand off|manual|readme|runbook|playbook|confluence|knowledge base|base de conocimiento|acta|minutes",
});

/** Initiative type -> cues, for the social / environmental "how". */
const IMPACT = table({
  voluntariado:
    "+voluntari|+volunteer|ayud|helped|sume|sumar|particip|jornada|comedor|comunitari|ong |organis|organiz|jurado|drive|hospital|plantamos|cocinamos|comunidad|community|solidari|charity|fundacion|foundation",
  donaciones:
    "+donacion|+dono |+done |+donamos|+donat|colecta|aporto|aporte|contribution|fundacion|feria|ropa|clothes|sangre|blood|alimentos|food|regalos|gifts",
  reciclaje:
    "+recicl|+residuo|+recycl|+waste|+compost|separo|separando|electronic|pilas|basura|trash|sorting",
  consumo:
    "+consumo|+impresion|+imprimir|+papel|+energia|+plastico|+print|+energy|reduc|botella|bottle|reutiliz|reusable|pages|ahorr|saved|luz |agua |water|electricity|apago",
  educacion:
    "+escuela|+educa|+ensen|+taller|+school|+teach|clases|classes|mentor|becas|scholarship|estudiantes|students|hackaton|hackathon|coding|universidad|university|capacitac|charla",
  movilidad:
    "+bici|+transporte publico|+caminando|+carpool|+bike|+cycle|tren |train|auto |autos|cycling|walk|moto|bus |colectivo|public transport",
});

// -- Signals ------------------------------------------------------------------

/** What People has to attend to -> cues. */
const SIGNALS: readonly (readonly [Signal, Cue[]])[] = [
  [
    "workload",
    cues(
      "horas de mas|muchas horas|muchisimas horas|hasta tarde|de noche|fines de semana|cansancio|agotamiento|redistribu|al limite|desconectar|long hours|weekends|carga de trabajo|sobrecarg|horas extra|agotad|burnout|estres|workload|overload|overtime|quedamos hasta|respeten los horarios",
    ),
  ],
  [
    "attrition",
    cues(
      "buscar algo nuevo|otras opciones|otras ofertas|propuestas de afuera|buscando de afuera|mirar otras|other offers|looking around|renunci|irme de|otro trabajo|otra empresa|dejar la empresa|propuesta laboral|quit|leave the company|another job|se vaya",
    ),
  ],
  [
    "conflict",
    cues(
      "discut|choco|chocaron|friccion|no me escuchan|clash|friction|conflict|discusion|maltrato|tension|roce",
    ),
  ],
  [
    "recognition",
    cues(
      "salarial|sueldo|nadie lo ve|no se ve|falta reconocimiento|reconocerle mas|banda del puesto|salary|underpaid|falta de reconocimiento|sin reconocimiento|no me siento valorad|no valoran|poco reconoc|not valued|dont feel valued|do not feel valued|lack of recognition",
    ),
  ],
  [
    "stagnation",
    cues(
      "mismo tipo de tareas|mismo producto|perdio desafio|sin desafio|camino de crecimiento|same tickets|same maintenance|something new|no challenge|estancad|no crezco|sin crecimiento|mismas tareas|no aprendo|stagnat|stuck|no growth",
    ),
  ],
  [
    "company_request",
    cues(
      "capacit|certificacion|herramientas|plan de carrera|presupuesto|entorno de pruebas|financie|rotar a|training|budget|better tools|career plan|la empresa deberia|la empresa podria|me gustaria que la empresa|santex deberia|deberian ofrecer|the company should|the company could|cambio de rol",
    ),
  ],
  [
    "role_fit",
    cues(
      "rol tecnico|cambio de rol|rol de analisis|mi perfil|su perfil|no es lo que queria|ademas de mi rol|rol actual|tareas de soporte|rol mas cercano|technical role|my profile|fuera de mi rol|no es mi rol|cambiar de rol|otro rol|cambio de proyecto|not my role|change roles|different role",
    ),
  ],
];

/** A request frame: a signal of the "asks the company for" kind needs one. */
const ASKING = cues(
  "necesit|quiero|quisiera|me gustaria|deberia|sugiero|ofrezc|ofrec|financi|hay que|conseguir|pedir|solicit|mas tiempo|mejores|poder |que la empresa|would like|i want|need|should|wish|better tools|tener un|tener una",
);

// -- Substance ----------------------------------------------------------------

/** An answer that says nothing ("n/a", "nada", "-"). */
const NOTHING =
  /^(n\/?a|na|-+|\.+|nada|ninguna?|ningun|no se|nothing|none|no aplica|sin comentarios|no comments?)[.!]?$/;
/** A short answer that says nothing in a sentence ("Nada en particular"). */
const NOTHING_PHRASE =
  /^(nada\b|ningun|todo bien\b|todavia no\b|aun no\b|no se\b|no pude\b|no participe\b|no tengo\b|no me entere\b|no hay\b|no por ahora\b|por ahora no\b|nothing\b|not yet\b|no idea\b|i dont know\b|i do not know\b)|\bninguna?\b|mejor que lo diga|no se me ocurre/;
/** Something concrete: a number, a quote, an example, a when. */
const CONCRETE =
  /\d|["“«]|\b(por ejemplo|cuando|como en|en el proyecto|for example|for instance|when|during|durante)\b/;
/** A result or an artifact: what an action left behind. */
const RESULT =
  /\b(pase|paso|pasamos|bajo|baje|redujo|reduje|ahorro|ahorr|cambio|cambie|usaron|usamos|usan|seguimos|nadie|casi nunca|ya |hoy |de \w+ a \w+|instead of|now |saved|reduced|from \w+ to)\b/;
/** A time or a frequency: an anchor in the calendar. */
const WHEN =
  /\b(este semestre|ultimo|ultima|semestre|trimestre|quarter|semana|week|mes\b|meses|month|ano|year|mensual|monthly|cada|every|once|vez|veces|saturdays|dias|days)\b/;

const NEGATORS = ["sin ", "no ", "without ", "nunca "];

/** The squashed text: lowercase, no accents, no punctuation, one space. */
const squash = (s: string) =>
  fold(s)
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Weight of the cues that hit `text` (padded with spaces), each once. With
 * `negatable`, a cue right after "sin", "no", "without" or "nunca" does not
 * count ("sin retrabajo" is not a complaint).
 */
function hits(text: string, list: readonly Cue[], negatable = false): number {
  let n = 0;
  for (const [cue, weight] of list) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(cue, from);
      if (at < 0) break;
      from = at + 1;
      // Start of a word only.
      if (/[a-z0-9]/.test(text[at - 1] ?? " ")) continue;
      if (negatable && NEGATORS.some((w) => text.endsWith(w, at))) continue;
      n += weight;
      break;
    }
  }
  return n;
}

const top = (counts: [string, number][], max: number): string[] =>
  counts
    .map((c, i) => [c[0], c[1], i] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[2] - b[2])
    .slice(0, max)
    .map(([name]) => name);

/** Past-tense achievements: "armé", "aprendí", "organizó", "rewrote", "helped". */
const ACHIEVEMENT =
  /\p{L}{3,}[éíó](?!\p{L})|\b(hizo|hice|fui|redujo|reduje|propuso|propuse|dijo|puso|wrote|rewrote|built|led|made|cut|sent|ran|took|won)\b|\b\w{3,}ed\b/u;

const DISCONTENT: readonly Signal[] = [
  "attrition",
  "recognition",
  "stagnation",
  "conflict",
  "workload",
];

/**
 * The tone, read from cues with the rubric in mind: where each answer is
 * going. Without a cue a text is neutral, whatever it answers.
 */
function readTone(
  input: AnalysisInput,
  raw: string,
  bare: string,
  text: string,
  initiative: boolean,
  discontent: boolean,
): Sentiment {
  const concern = hits(text, CONCERN, true) > 0;
  const step = hits(text, STEP) > 0;
  const request = hits(text, REQUEST) > 0 || OPENERS.test(bare);
  const gap = hits(text, GAP) > 0;
  const contrast = hits(text, CONTRAST) > 0;
  const action = hits(text, ACTION) > 0 || ACHIEVEMENT.test(raw);
  const praise = hits(text, PRAISE, true) > 0;

  switch (input.rubric) {
    case "improvement":
      // What to improve: a step is constructive even next to a problem;
      // only a complaint or a leaving risk without one is negative.
      if (step) return "constructive";
      if (concern || discontent) return "negative";
      if (gap || request) return "constructive";
      return praise ? "positive" : "neutral";
    case "yes_no_detail":
      if (step) return "constructive";
      if (input.yesNo === "yes" && (initiative || action || praise)) {
        return "positive";
      }
      return "neutral";
    case "strengths": {
      const praised = praise || action;
      if (praised && (concern || contrast)) return "mixed";
      if (concern) return step ? "constructive" : "negative";
      if (praised) return "positive";
      return step ? "constructive" : "neutral";
    }
    default:
      // What would help me, or any other free text.
      if (praise && concern) return "mixed";
      if (step || OPENERS.test(bare) || (request && !praise)) {
        return "constructive";
      }
      if (concern) return "negative";
      return praise ? "positive" : "neutral";
  }
}

/** The signals People has to attend to, strongest first. */
function readSignals(text: string): Signal[] {
  const asking = hits(text, ASKING) > 0;
  // "ahorró discusiones" is the opposite of a conflict.
  const avoided =
    /\b(evit\w*|ahorr\w*) (varias |muchas |las )?(discus|conflict)/.test(text);
  return top(
    SIGNALS.map(([k, list]): [string, number] => {
      if (k === "company_request" && !asking) return [k, 0];
      if (k === "conflict" && avoided) return [k, 0];
      return [k, hits(text, list)];
    }),
    SIGNALS.length,
  ) as Signal[];
}

/**
 * A demo heuristic, not an analysis (provider "mock", a DEMO_PROVIDERS
 * entry): deterministic lexical cues, for demos, tests and as the default
 * when no real provider is configured. It never fabricates a tone from the
 * question: without cues a text is neutral. Its confidence is null (it does
 * not estimate one).
 */
export class MockProvider implements AnalysisProvider {
  readonly name = "mock";
  readonly promptVersion = "mock-v5";

  async analyze(batch: AnalysisInput[]): Promise<AnalysisOutput[]> {
    return batch.map((input) => analyzeOne(input));
  }
}

export function analyzeOne(input: AnalysisInput): AnalysisOutput {
  const raw = input.text;
  const bare = squash(raw);
  const text = ` ${bare} `;

  const impact =
    input.rubric === "yes_no_detail" && isImpactQuestion(input.question);
  const themes = top(
    (impact ? IMPACT : THEMES).map(([k, list]) => [k, hits(text, list)]),
    3,
  );
  const signals = readSignals(text);
  // "No sé, mejor que lo diga mi líder": an answer that gives no reading.
  const sentiment = /^no se\b/.test(bare)
    ? "neutral"
    : readTone(
        input,
        raw,
        bare,
        text,
        impact && themes.length > 0,
        signals.some((s) => DISCONTENT.includes(s)),
      );

  const words = bare.split(" ").filter(Boolean).length;
  let substance: Substance;
  if (
    (words <= 1 && themes.length === 0) ||
    NOTHING.test(fold(raw).trim()) ||
    (words <= 9 && NOTHING_PHRASE.test(bare)) ||
    // Only praise where an improvement was asked answers nothing.
    (input.rubric === "improvement" &&
      sentiment === "positive" &&
      signals.length === 0)
  ) {
    substance = "none";
  } else {
    // Anchors: an example, a result, a when, a name.
    const anchors =
      (CONCRETE.test(raw) ? 1 : 0) +
      (RESULT.test(text) ? 1 : 0) +
      (WHEN.test(text) ? 1 : 0) +
      (/\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/.test(raw.trimStart()) ? 1 : 0);
    substance =
      words >= 6 &&
      (anchors >= 2 || words >= 14 || (anchors >= 1 && words >= 9))
        ? "specific"
        : "generic";
  }
  return {
    token: input.token,
    substance,
    themes,
    signals,
    sentiment,
    confidence: null,
  };
}
