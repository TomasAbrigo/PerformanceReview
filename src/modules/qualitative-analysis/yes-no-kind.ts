// Drizzle- and server-free: shared by the queries and client components.
import type { LocalizedText } from "@/db/schema/rating-scales";
import { fold } from "./dimension";
import type { YesNoKind } from "./reading-types";
import { isImpactQuestion } from "./themes";

/**
 * What a yes/no question asks, from its prompt: information security
 * ("¿Cumplo con … seguridad de la información?") and frequent conversations
 * ("¿Hablo con esta persona con la frecuencia suficiente…?") are alerts when
 * the answer is No; social / environmental impact carry a "how" whose
 * themes are initiative types.
 */
export function yesNoKindOf(prompt: LocalizedText): YesNoKind {
  const text = fold(`${prompt.es} ${prompt.en}`);
  if (/seguridad de la informacion|information security/.test(text)) {
    return "security";
  }
  if (/frecuencia|frequent|speak with|hablo con/.test(text)) {
    return "conversations";
  }
  if (isImpactQuestion(prompt)) return "impact";
  return "other";
}

/** The kinds whose "No" is an alert. */
export const ALERT_KINDS: readonly YesNoKind[] = ["security", "conversations"];
