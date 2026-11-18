import { useTranslations } from "next-intl";

/** A theme key nobody named yet, readable: "salud_mental" -> "Salud mental". */
export const humanizeTheme = (key: string) => {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toLocaleUpperCase("es") + words.slice(1);
};

/**
 * Theme keys are normalized (lowercase, no accents: "planificacion"); people
 * read them through their message in `Themes` ("Planificación"), or
 * humanized when the analysis added one without a message.
 */
export function useThemeLabel(): (key: string) => string {
  const t = useTranslations("Themes");
  return (key) =>
    t.has(key as "proyecto") ? t(key as "proyecto") : humanizeTheme(key);
}
