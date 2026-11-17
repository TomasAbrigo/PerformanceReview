import { getTranslations } from "next-intl/server";

/** dimension key -> label in the request's language (unknown keys as-is). */
export async function dimensionLabels(
  dimensions: string[],
): Promise<Record<string, string>> {
  const t = await getTranslations("Qualitative.dimensions");
  return Object.fromEntries(
    dimensions.map((d) => [d, t.has(d as "other") ? t(d as "other") : d]),
  );
}
