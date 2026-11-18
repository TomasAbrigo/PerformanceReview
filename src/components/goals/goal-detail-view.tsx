import { Check, Circle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useDates } from "@/components/dates";
import { Fact } from "@/components/fact";
import { cycleName } from "@/modules/review-core/cycle-name";
import { Panel } from "@/components/insights/parts";
import { ProgressBar } from "@/components/progress-bar";
import { Link } from "@/i18n/navigation";
import type { GoalDetail } from "@/modules/goals/browse";
import { GoalStateBadge } from "./goal-state-badge";

/**
 * A goal's page body: the summary (state, progress, the three dates), its
 * description, milestones and comments, and the assessments that list it
 * among the goals of their period (the way back to the Assessments area,
 * only the ones the reader may open).
 */
export function GoalDetailView({
  goal,
  openableParticipants,
}: {
  goal: GoalDetail;
  /** Participant ids whose assessment page the reader may open. */
  openableParticipants: ReadonlySet<string>;
}) {
  const locale = useLocale();
  const t = useTranslations("Goals.detail");
  const tg = useTranslations("Goals");
  const d = useDates();
  const doneMilestones = goal.milestones.filter((m) => m.completedAt).length;
  return (
    <div className="flex flex-col gap-6">
      <Panel id="goal-summary" title={t("summary")}>
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t("owner")}>{goal.person.name}</Fact>
          <Fact label={t("department")}>{goal.department ?? "–"}</Fact>
          <Fact label={t("state")}>
            <GoalStateBadge state={goal.state} />
          </Fact>
          <Fact label={t("progress")}>
            <ProgressBar
              percent={goal.percentComplete}
              label={tg("progress", { percent: goal.percentComplete })}
            />
          </Fact>
          <Fact label={t("created")}>{d.moment(goal.createdAt)}</Fact>
          <Fact label={t("due")}>
            {goal.dueDate ? d.day(goal.dueDate) : t("noDate")}
          </Fact>
          <Fact label={t("finished")}>
            {goal.completionDate ? d.day(goal.completionDate) : t("noDate")}
          </Fact>
          <Fact label={t("updated")}>
            {goal.lastChangedAt ? d.moment(goal.lastChangedAt) : t("noDate")}
          </Fact>
        </dl>
      </Panel>
      <Panel id="goal-description" title={t("description")}>
        {goal.description ? (
          <p className="max-w-3xl text-sm whitespace-pre-line">
            {goal.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noDescription")}</p>
        )}
      </Panel>
      <Panel
        id="goal-milestones"
        title={t("milestones")}
        hint={
          goal.milestones.length > 0
            ? t("milestonesDone", {
                done: doneMilestones,
                total: goal.milestones.length,
              })
            : undefined
        }
      >
        {goal.milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noMilestones")}</p>
        ) : (
          <ol className="flex flex-col gap-2 text-sm">
            {goal.milestones.map((m) => (
              <li key={m.id} className="flex items-start gap-3">
                {m.completedAt ? (
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-status-done"
                    aria-hidden="true"
                  />
                ) : (
                  <Circle
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="flex flex-col">
                  {m.title}
                  <span className="text-xs text-muted-foreground">
                    {m.completedAt
                      ? t("milestoneDone", { date: d.moment(m.completedAt) })
                      : t("milestoneOpen")}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <Panel id="goal-comments" title={t("comments")}>
        {goal.comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noComments")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {goal.comments.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {c.author ?? t("unknownAuthor")}
                  </span>
                  {c.postedAt ? ` · ${d.moment(c.postedAt)}` : null}
                </span>
                <p className="max-w-3xl whitespace-pre-line">{c.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel
        id="goal-assessments"
        title={t("assessments")}
        hint={t("assessmentsHint")}
      >
        {goal.appearances.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("notInAssessments")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {goal.appearances.map((a) => (
              <li key={a.participantId}>
                {openableParticipants.has(a.participantId) ? (
                  <Link
                    href={`/assessments/${a.cycleId}/${a.participantId}`}
                    className="underline"
                  >
                    {t("openAssessment", {
                      cycle: cycleName(
                        { name: a.cycleName, localizedName: a.localizedName },
                        locale,
                      ),
                    })}
                  </Link>
                ) : (
                  cycleName(
                    { name: a.cycleName, localizedName: a.localizedName },
                    locale,
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
