"use client";

import { useTranslations } from "next-intl";

/** Translates a review-core error code (or field issue) to a UI message. */
export function useCycleError() {
  const t = useTranslations("Cycles.errors");
  return (code: string) =>
    t.has(code as "unknown") ? t(code as "unknown") : t("unknown");
}
