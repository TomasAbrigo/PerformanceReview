"use client";

import { LockKeyhole } from "lucide-react";
import { IconTile } from "@/components/experience";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** "Sin acceso": what a screen shows to a role that may not use it. */
export function NoAccess() {
  const t = useTranslations("Access");
  return (
    <section
      className="flex max-w-xl flex-col gap-3 rounded-xl border border-border bg-card p-6"
      data-testid="no-access"
    >
      <IconTile>
        <LockKeyhole />
      </IconTile>
      <h1>{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <Link href="/" className="text-sm underline">
        {t("home")}
      </Link>
    </section>
  );
}
