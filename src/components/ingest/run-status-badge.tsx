import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/modules/ingest/run-status";

const VARIANT = {
  running: "secondary",
  succeeded: "success",
  error: "destructive",
  needs_decision: "warning",
} as const satisfies Record<RunStatus, string>;

/** `ingest_run.status` as a localized badge. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
  const t = useTranslations("Imports.runs.status");
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
