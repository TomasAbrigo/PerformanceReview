import { getTranslations } from "next-intl/server";

/** The kicker of a screen: the name of the group it belongs to (server side). */
export async function groupKicker(group: "insights" | "data" | "settings") {
  const t = await getTranslations("Home");
  return t(`groups.${group}`);
}
