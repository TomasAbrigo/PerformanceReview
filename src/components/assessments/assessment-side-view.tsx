import { useLocale, useTranslations } from "next-intl";
import { useDates } from "@/components/dates";
import { Panel } from "@/components/insights/parts";
import { type AssessmentSide, pickLocalized } from "@/modules/assessments";
import { AnswerValue } from "./answer-value";
import { RequestStateChip } from "./state-chip";

/**
 * One side of the form (the self-assessment or the manager review): who
 * wrote it and when, and each question with its answer. A side that is not
 * there, or not for this reader yet, says so instead of showing questions.
 */
export function AssessmentSideView({ side }: { side: AssessmentSide }) {
  const t = useTranslations("Assessments.detail");
  const locale = useLocale();
  const d = useDates();
  const sectionTitles = side.sections.length > 1;
  const note = side.state === "submitted" ? null : side.state;
  return (
    <Panel
      id={`assessment-${side.relationship}`}
      title={t(`sides.${side.relationship}`)}
      actions={<RequestStateChip state={side.state} />}
    >
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {side.author ? <p>{t("author", { name: side.author.name })}</p> : null}
        {side.submittedAt ? (
          <p>{t("submittedAt", { date: d.moment(side.submittedAt) })}</p>
        ) : null}
        {side.relationship === "manager" && side.state !== "none" ? (
          <p>
            {side.sharedAt
              ? t("sharedAt", { date: d.moment(side.sharedAt) })
              : t("notShared")}
          </p>
        ) : null}
      </div>
      {note ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(`stateNote.${note}`)}
        </p>
      ) : null}
      {side.sections.length === 0 &&
      (side.state === "submitted" || side.state === "draft") ? (
        <p className="text-sm text-muted-foreground">{t("noSections")}</p>
      ) : null}
      {side.sections.map((section, i) => (
        <section key={i} className="flex flex-col gap-4">
          {sectionTitles ? (
            <h3 className="text-base">
              {pickLocalized(section.title, locale)}
            </h3>
          ) : null}
          <dl className="flex flex-col gap-4">
            {section.questions.map((q) => (
              <div
                key={q.id}
                data-testid="question"
                className="flex flex-col gap-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0"
              >
                <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-medium">
                  {pickLocalized(q.prompt, locale)}
                  {q.custom ? (
                    <span className="kicker text-brand-600">{t("custom")}</span>
                  ) : null}
                  {!q.visibleToReviewee ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("hiddenFromEmployee")}
                    </span>
                  ) : null}
                </dt>
                <dd className="text-sm">
                  <AnswerValue question={q} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Panel>
  );
}
