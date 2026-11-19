import { getLocale, getTranslations } from "next-intl/server";
import {
  dimensionLabels as labelsOf,
  KNOWN_DIMENSIONS,
} from "@/components/qualitative/dimension-labels";
import { db } from "@/db/client";
import type { LocalizedText } from "@/db/schema/rating-scales";
import { dimensionPrompts } from "@/modules/qualitative-analysis";

/**
 * dimension key -> label in the request's language: the message of a known
 * key, else the prompt of the dimension's latest question (`prompts`, see
 * `dimensionPrompts`; the custom questions of the Santex template are
 * `custom_<n>`, #123), else "Pregunta personalizada n" for a `custom_<n>`
 * without a question, else the key as-is.
 */
export async function dimensionLabels(
  dimensions: string[],
  prompts?: Record<string, LocalizedText>,
): Promise<Record<string, string>> {
  const t = await getTranslations("Qualitative");
  const locale = (await getLocale()) === "en" ? "en" : "es";
  // Only a dimension without a name of its own needs its question's prompt.
  const unnamed = dimensions.some(
    (d) => !(KNOWN_DIMENSIONS as readonly string[]).includes(d),
  );
  const resolved = prompts ?? (unnamed ? await dimensionPrompts(db) : {});
  return labelsOf(dimensions, {
    names: Object.fromEntries(
      KNOWN_DIMENSIONS.map((k) => [k, t(`dimensions.${k}`)]),
    ),
    custom: (n) => t("customDimension", { n }),
    prompts: resolved,
    locale,
  });
}
