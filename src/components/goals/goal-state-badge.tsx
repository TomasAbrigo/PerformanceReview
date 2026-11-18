import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { GoalState } from "@/modules/goals/state";

const VARIANT = {
  in_progress: "secondary",
  completed: "success",
  closed: "outline",
  overdue: "destructive",
} as const satisfies Record<GoalState, string>;

/** A goal's state as a labelled chip (the word, never the color alone). */
export function GoalStateBadge({ state }: { state: GoalState }) {
  const t = useTranslations("Goals.states");
  return (
    <Badge variant={VARIANT[state]} data-state={state}>
      {t(state)}
    </Badge>
  );
}
