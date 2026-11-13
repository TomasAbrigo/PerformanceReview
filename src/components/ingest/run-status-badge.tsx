import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { isRunStatus, type RunStatus } from "@/modules/ingest/run-status";

const VARIANT = {
  running: "secondary",
  succeeded: "default",
  error: "destructive",
} as const satisfies Record<RunStatus, string>;

/** `ingest_run.status` as a localized badge. */
export function RunStatusBadge({ status }: { status: string | null }) {
  const t = useTranslations("Imports.runs.status");
  if (!isRunStatus(status))
    return <Badge variant="outline">{t("unknown")}</Badge>;
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
