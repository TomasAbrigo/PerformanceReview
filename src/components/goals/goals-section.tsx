import { useTranslations } from "next-intl";
import type { GoalView } from "@/modules/goals";
import { GoalCard } from "./goal-card";

/** A person's goals as cards, in the order given (due date). */
export function GoalsSection({ goals }: { goals: GoalView[] }) {
  const t = useTranslations("Goals");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">{t("title")}</h2>
      {goals.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </div>
      )}
    </section>
  );
}
