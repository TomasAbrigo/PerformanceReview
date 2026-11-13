import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

/** Bamboo status ("Active"/"Inactive"/…) as a localized badge. */
export function StatusBadge({ status }: { status: string | null }) {
  const t = useTranslations("People.status");
  const active = status?.toLowerCase() === "active";
  if (!status) return <Badge variant="outline">{t("unknown")}</Badge>;
  return (
    <Badge variant={active ? "default" : "secondary"}>
      {active ? t("active") : t("inactive")}
    </Badge>
  );
}
