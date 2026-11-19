import type { Locale } from "@/i18n/routing";
import type { Signal } from "@/modules/qualitative-analysis/constants";

/**
 * Header cells of the open-text reading CSVs (#129) that the shared
 * `Exports.columns` messages do not have: one text per column in the language
 * of the file (`?locale=`), the data is the same in both. The ones the
 * exports already had (`dimension`, `group`, `people`, `positive`…) still
 * come from the messages.
 */
type ReadingKey =
  | "side"
  | "substance_people"
  | "substance_none"
  | "substance_generic"
  | "substance_specific"
  | "substance_none_pct"
  | "substance_generic_pct"
  | "substance_specific_pct"
  | `signal_${Signal}`
  | "signal_any"
  | "manager_feedback_people"
  | "manager_feedback_none"
  | "manager_feedback_generic"
  | "manager_feedback_specific"
  | "manager_feedback_none_pct"
  | "manager_feedback_generic_pct"
  | "manager_feedback_specific_pct"
  | "yes"
  | "no"
  | "yes_pct"
  | "no_pct"
  | "choice_label"
  | "base_people"
  | "people_pct";

const HEADERS: Record<Locale, Record<ReadingKey, string>> = {
  es: {
    side: "lado",
    substance_people: "personas con sustancia leída",
    substance_none: "sustancia: sin contenido",
    substance_generic: "sustancia: genérico",
    substance_specific: "sustancia: concreto",
    substance_none_pct: "sustancia: sin contenido (%)",
    substance_generic_pct: "sustancia: genérico (%)",
    substance_specific_pct: "sustancia: concreto (%)",
    signal_workload: "señal: carga de trabajo",
    signal_attrition: "señal: intención de irse",
    signal_conflict: "señal: conflicto",
    signal_recognition: "señal: falta de reconocimiento",
    signal_stagnation: "señal: estancamiento",
    signal_company_request: "señal: pedido a la empresa",
    signal_role_fit: "señal: encaje con el rol",
    signal_any: "con alguna señal",
    manager_feedback_people: "feedback del manager: personas",
    manager_feedback_none: "feedback del manager: sin contenido",
    manager_feedback_generic: "feedback del manager: genérico",
    manager_feedback_specific: "feedback del manager: concreto",
    manager_feedback_none_pct: "feedback del manager: sin contenido (%)",
    manager_feedback_generic_pct: "feedback del manager: genérico (%)",
    manager_feedback_specific_pct: "feedback del manager: concreto (%)",
    yes: "Sí",
    no: "No",
    yes_pct: "Sí (%)",
    no_pct: "No (%)",
    choice_label: "opción",
    base_people: "base (personas)",
    people_pct: "personas (%)",
  },
  en: {
    side: "side",
    substance_people: "substance_people",
    substance_none: "substance_none",
    substance_generic: "substance_generic",
    substance_specific: "substance_specific",
    substance_none_pct: "substance_none_pct",
    substance_generic_pct: "substance_generic_pct",
    substance_specific_pct: "substance_specific_pct",
    signal_workload: "signal_workload",
    signal_attrition: "signal_attrition",
    signal_conflict: "signal_conflict",
    signal_recognition: "signal_recognition",
    signal_stagnation: "signal_stagnation",
    signal_company_request: "signal_company_request",
    signal_role_fit: "signal_role_fit",
    signal_any: "signal_any",
    manager_feedback_people: "manager_feedback_people",
    manager_feedback_none: "manager_feedback_none",
    manager_feedback_generic: "manager_feedback_generic",
    manager_feedback_specific: "manager_feedback_specific",
    manager_feedback_none_pct: "manager_feedback_none_pct",
    manager_feedback_generic_pct: "manager_feedback_generic_pct",
    manager_feedback_specific_pct: "manager_feedback_specific_pct",
    yes: "yes",
    no: "no",
    yes_pct: "yes_pct",
    no_pct: "no_pct",
    choice_label: "choice_label",
    base_people: "base_people",
    people_pct: "people_pct",
  },
};

export type ReadingHeader = (key: ReadingKey) => string;

/** Header text of a reading column in the file's language. */
export const readingHeaderIn =
  (locale: Locale): ReadingHeader =>
  (key) =>
    HEADERS[locale][key];
