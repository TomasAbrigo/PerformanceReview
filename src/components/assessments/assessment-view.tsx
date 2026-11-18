import { useTranslations } from "next-intl";
import { useDates } from "@/components/dates";
import { Fact } from "@/components/fact";
import { Link } from "@/i18n/navigation";
import type { AssessmentDetail } from "@/modules/assessments";
import { AssessmentSideView } from "./assessment-side-view";
import { GoalsOfPeriod } from "./goals-of-period";

/**
 * A participant's assessment page body: who and what snapshot, the toggle to
 * read it as the employee would (for whoever is not the employee), the goals
 * of the period, and the self-assessment and the manager review side by side.
 */
export function AssessmentView({
  detail,
  cycleName,
  toggle,
}: {
  detail: AssessmentDetail;
  /** The cycle's name in the reader's language. */
  cycleName: string;
  /** The hrefs of the two views; absent when the reader is the employee (nothing to compare). */
  toggle?: { full: string; employee: string };
}) {
  const t = useTranslations("Assessments.detail");
  const d = useDates();
  const { participant } = detail;
  const name = participant.person.name;
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t("cycle")}>{cycleName}</Fact>
        <Fact label={t("manager")}>
          {participant.manager?.name ?? t("noManager")}
        </Fact>
        <Fact label={t("department")}>{participant.department ?? "–"}</Fact>
        <Fact label={t("jobTitle")}>{participant.jobTitle ?? "–"}</Fact>
      </dl>
      <p className="text-xs text-muted-foreground">
        {t("snapshot", { date: d.day(participant.snapshotAsOf) })}
        {participant.removed ? ` · ${t("removed")}` : null}
      </p>
      {toggle ? (
        <div className="flex flex-col gap-2">
          <div
            role="group"
            aria-label={t("view.label")}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <span className="text-xs font-medium text-muted-foreground">
              {t("view.label")}
            </span>
            <span className="segmented">
              <Link
                href={toggle.full}
                aria-current={detail.employeeView ? undefined : "true"}
              >
                {t("view.full")}
              </Link>
              <Link
                href={toggle.employee}
                aria-current={detail.employeeView ? "true" : undefined}
              >
                {t("view.employee")}
              </Link>
            </span>
          </div>
          {detail.employeeView ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t("view.note", { name })}
            </p>
          ) : null}
        </div>
      ) : null}
      <GoalsOfPeriod goals={detail.goals} name={name} asOf={detail.goalsAsOf} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {detail.sides.map((side) => (
          <AssessmentSideView
            key={side.relationship}
            side={side}
            employeeView={detail.employeeView || !toggle}
          />
        ))}
      </div>
    </div>
  );
}
