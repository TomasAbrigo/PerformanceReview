// The strings of the exported HTML: the `Arturia` namespace of the app
// messages (plain JSON import; the CLI has no next-intl), so the es/en parity
// test covers them.
import en from "@/messages/en.json";
import es from "@/messages/es.json";

export const reportLocales = ["es", "en"] as const;
export type ReportLocale = (typeof reportLocales)[number];

export type Labels = (typeof es)["Arturia"];

export const labelsFor = (locale: ReportLocale = "es"): Labels =>
  locale === "en" ? en.Arturia : es.Arturia;

/** Spanish, the default (the HTML is for People). */
export const labels = labelsFor("es");
