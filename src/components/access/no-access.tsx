"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** "Sin acceso": what a screen shows to a role that may not use it. */
export function NoAccess() {
  const t = useTranslations("Access");
  return (
    <section className="flex flex-col gap-2" data-testid="no-access">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>
      <Link href="/" className="underline">
        {t("home")}
      </Link>
    </section>
  );
}
