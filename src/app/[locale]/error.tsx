"use client";

import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { IconTile } from "@/components/experience";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const t = useTranslations("Experience");
  return (
    <section
      role="alert"
      className="admin-surface flex max-w-xl flex-col items-start gap-5"
    >
      <IconTile>
        <AlertCircle />
      </IconTile>
      <h1 className="text-2xl">{t("loadError")}</h1>
      <Button onClick={retry}>{t("retry")}</Button>
    </section>
  );
}
