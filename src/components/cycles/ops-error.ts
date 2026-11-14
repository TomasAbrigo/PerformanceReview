"use client";

import { useTranslations } from "next-intl";

/** Translates an operations error code (cycles, reviews or ops) to a message. */
export function useOpsError() {
  const t = useTranslations("Ops.errors");
  return (code: string) =>
    t.has(code as "unknown") ? t(code as "unknown") : t("unknown");
}
