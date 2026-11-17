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

/** Catalog rows (dimension, theme) of the initial vocabulary for `dimensions`. */
export function initialThemeRows(dimensions: string[]) {
  return [...new Set(dimensions)].flatMap((dimension) =>
    INITIAL_THEMES.map((name) => ({ dimension, name })),
  );
}
