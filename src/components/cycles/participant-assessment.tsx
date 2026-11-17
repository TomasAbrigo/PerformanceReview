import { useFormatter, useTranslations } from "next-intl";
import {
  ReadOnlyAnswers,
  type ReviewData,
} from "@/components/review/read-only-answers";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { PeriodGoalsBlock, type PeriodGoalView } from "./period-goals-block";

export type ParticipantAssessmentData = {
  cycle: { id: string; name: string; periodStart: string; periodEnd: string };
  participant: {
    id: string;
    name: string;
    managerName: string | null;
    department: string | null;
    jobTitle: string | null;
    removed: boolean;
  };
  goals: PeriodGoalView[];
  goalsAsOf: Date | null;
  reviews: {
    relationship: "self" | "manager";
    reviewerName: string | null;
    reviewerMismatch: boolean;
    review: ReviewData;
  }[];
};

/**
 * The assessment of one participant of an imported cycle: the answers of the
 * submitted self and manager reviews (what the viewer may read) and the goals
 * of the period. Read only.
 */
export function ParticipantAssessmentView({
  data,
}: {
  data: ParticipantAssessmentData;
}) {
  const t = useTranslations("ParticipantDetail");
  const tCycles = useTranslations("Cycles");
  const format = useFormatter();
  const { cycle, participant } = data;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/cycles/${cycle.id}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {t("title", { name: participant.name, cycle: cycle.name })}
          </h1>
          {participant.removed ? (
            <Badge variant="secondary">{t("removed")}</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {tCycles("period", {
            start: cycle.periodStart,
            end: cycle.periodEnd,
          })}
          {" · "}
          {participant.managerName
            ? t("manager", { name: participant.managerName })
            : t("noManager")}
          {participant.jobTitle || participant.department
            ? ` · ${t("job", {
                title: participant.jobTitle ?? "–",
                department: participant.department ?? "–",
              })}`
            : ""}
        </p>
      </header>

      <section
        aria-labelledby="assessment-answers-title"
        data-testid="assessment-answers"
        className="flex flex-col gap-4"
      >
        <h2 id="assessment-answers-title" className="text-lg font-medium">
          {t("answers.title")}
        </h2>
        {data.reviews.length === 0 ? (
          <p>{t("answers.empty")}</p>
        ) : (
          data.reviews.map((r) => (
            <article
              key={r.review.requestId}
              aria-label={t(`answers.${r.relationship}`)}
              className="flex flex-col gap-2 rounded-md border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">
                  {t(`answers.${r.relationship}`)}
                </h3>
                {r.reviewerName ? (
                  <span className="text-sm text-muted-foreground">
                    {t("answers.reviewer", { name: r.reviewerName })}
                  </span>
                ) : null}
                {r.reviewerMismatch ? (
                  <Badge variant="destructive">{t("answers.mismatch")}</Badge>
                ) : null}
                {r.review.submittedAt ? (
                  <span className="text-sm text-muted-foreground">
                    {format.dateTime(r.review.submittedAt, {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    })}
                  </span>
                ) : null}
              </div>
              {r.review.questions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("answers.noQuestions")}
                </p>
              ) : (
                <ReadOnlyAnswers review={r.review} />
              )}
            </article>
          ))
        )}
      </section>

      <PeriodGoalsBlock goals={data.goals} asOf={data.goalsAsOf} />
    </div>
  );
}
