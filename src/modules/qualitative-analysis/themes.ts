// Drizzle- and server-free: the controlled theme vocabulary.

/**
 * The initial theme vocabulary (normalized keys: lowercase, no accents), the
 * same eight People's dashboard groups comments by. Every dimension starts
 * with them; the analysis may add more (they are catalogued as they appear).
 */
export const INITIAL_THEMES = [
  "proyecto",
  "equipo",
  "comunicacion",
  "crecimiento",
  "cultura",
  "procesos",
  "bienestar",
  "reconocimiento",
] as const;
export type InitialTheme = (typeof INITIAL_THEMES)[number];

/** Competencies: what a strength or an area to improve is about (#128). */
export const COMPETENCY_THEMES = [
  "tecnica",
  "planificacion",
  "calidad",
  "liderazgo",
  "proactividad",
  "negocio",
  "aprendizaje",
  "documentacion",
] as const;

/** The controlled vocabulary of open answers: People's eight + competencies. */
export const THEMES = [...INITIAL_THEMES, ...COMPETENCY_THEMES] as const;

/** Initiative types: the themes of the social / environmental "how" (#128). */
export const IMPACT_THEMES = [
  "voluntariado",
  "donaciones",
  "reciclaje",
  "consumo",
  "educacion",
  "movilidad",
] as const;

/** Old keys folded into the vocabulary ("colaboracion" is "equipo"). */
const ALIASES: Record<string, string> = { colaboracion: "equipo" };

/** The vocabulary key of a normalized theme (aliases folded). */
export const canonicalTheme = (key: string): string =>
  Object.hasOwn(ALIASES, key) ? ALIASES[key] : key;

/** Whether a question is about social or environmental impact initiatives. */
export function isImpactQuestion(prompt: { es: string; en: string }): boolean {
  const text = `${prompt.es} ${prompt.en}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return /\b(social|ambient|environment|sustentab|sostenib|sustainab|impact|iniciativa|initiative)/.test(
    text,
  );
}

/** Catalog rows (dimension, theme) of the initial vocabulary for `dimensions`. */
export function initialThemeRows(dimensions: string[]) {
  return [...new Set(dimensions)].flatMap((dimension) =>
    INITIAL_THEMES.map((name) => ({ dimension, name })),
  );
}
