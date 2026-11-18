import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RequestState } from "@/modules/assessments/state";

const GLYPH: Record<Exclude<RequestState, "locked">, string> = {
  submitted: "✓",
  draft: "◐",
  declined: "✕",
  none: "–",
};

/** One side's state as a chip: a glyph and the word, never the color alone. */
export function RequestStateChip({ state }: { state: RequestState }) {
  const t = useTranslations("Assessments.states");
  return (
    <span
      data-state={state}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${
        state === "submitted"
          ? "bg-status-done-bg text-status-done"
          : state === "draft"
            ? "bg-status-progress-bg font-medium text-status-progress"
            : state === "declined"
              ? "bg-status-pending-bg text-status-pending"
              : "bg-brand-fog text-muted-foreground"
      }`}
    >
      {state === "locked" ? (
        <Lock className="size-3" aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{GLYPH[state]}</span>
      )}
      {t(state)}
    </span>
  );
}
