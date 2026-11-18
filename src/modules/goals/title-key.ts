/**
 * How the goals ingest tells that a Bamboo goal and one written in the app are
 * the same goal of a person (#106): the title without case, accents,
 * punctuation at the ends or repeated spaces.
 */
export function goalTitleKey(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s.,;:!?¡¿"'-]+|[\s.,;:!?¡¿"'-]+$/g, "");
}
