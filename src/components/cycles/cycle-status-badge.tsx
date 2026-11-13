import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { CycleStatus } from "@/modules/review-core/status";

export function CycleStatusBadge({ status }: { status: CycleStatus }) {
  const t = useTranslations("Cycles.status");
  const variant =
    status === "draft"
      ? "outline"
      : status === "closed"
        ? "secondary"
        : "default";
  return <Badge variant={variant}>{t(status)}</Badge>;
}
