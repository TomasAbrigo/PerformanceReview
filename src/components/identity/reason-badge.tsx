import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { IdentityIssueReason } from "@/db/schema/identity";

const VARIANTS = {
  no_match: "secondary",
  ambiguous: "default",
  conflict: "destructive",
} as const;

/** Why a record is in the identity queue, as a localized badge. */
export function ReasonBadge({ reason }: { reason: IdentityIssueReason }) {
  const t = useTranslations("Identity.reason");
  return <Badge variant={VARIANTS[reason]}>{t(reason)}</Badge>;
}
