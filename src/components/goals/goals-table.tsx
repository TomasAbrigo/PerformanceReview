import { ArrowUpRight, CalendarDays, Flag, Target } from "lucide-react";
import {
  EmptyState,
  IconTile,
  MetricCard,
  ProgressRing,
} from "@/components/experience";
import { useTranslations } from "next-intl";
import { CountChips } from "@/components/count-chips";
import { useDates } from "@/components/dates";
import { Pagination } from "@/components/pagination";
import { ProgressBar } from "@/components/progress-bar";
import { Link } from "@/i18n/navigation";
import type { GoalListPage } from "@/modules/goals/browse";
import { goalStates, type GoalState } from "@/modules/goals/state";
import { GoalStateBadge } from "./goal-state-badge";

/** The counts per state, each a link that filters the list by it. */
export function GoalStateChips({
  counts,
  current,
  hrefFor,
}: {
  counts: GoalListPage["counts"];
  current: GoalState | undefined;
  hrefFor: (state: GoalState | undefined) => string;
}) {
  const t = useTranslations("Goals");
  return (
    <CountChips
      label={t("summary")}
      all={{
        label: t("filters.anyState"),
        count: goalStates.reduce((sum, s) => sum + counts[s], 0),
      }}
      items={goalStates.map((s) => ({
        value: s,
        label: t(`states.${s}`),
        count: counts[s],
      }))}
      current={current}
      hrefFor={hrefFor}
    />
  );
}

/**
 * One row per goal: title (the link to its page), owner (unless it is
 * always the actor), state, progress bar, due date and how many of its
 * milestones are done.
 */
export function GoalsTable({
  page,
  showPerson,
  hrefForPage,
}: {
  page: GoalListPage;
  showPerson: boolean;
  hrefForPage: (page: number) => string;
}) {
  const t = useTranslations("Goals");
  const d = useDates();
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  if (page.items.length === 0) {
    return <EmptyState>{t("empty")}</EmptyState>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div role="group" className="goal-grid" aria-label={t("table.label")}>
        {page.items.map((g) => (
          <article
            key={g.id}
            className="goal-card"
            aria-labelledby={`goal-${g.id}`}
          >
            <div className="flex items-center justify-between gap-3">
              <IconTile>
                <Target className="size-5" />
              </IconTile>
              <GoalStateBadge state={g.state} />
            </div>
            <h2 id={`goal-${g.id}`} className="text-xl leading-snug">
              <Link href={`/goals/${g.id}`} className="card-link">
                {g.title}
              </Link>
            </h2>
            {showPerson ? (
              <p className="text-sm text-muted-foreground">
                {g.person.name}
                {g.department ? (
                  <span className="block text-xs">{g.department}</span>
                ) : null}
              </p>
            ) : null}
            <div className="mt-auto space-y-2 pt-2">
              <span className="text-xs text-muted-foreground">
                {t("table.progress")}
              </span>
              <ProgressBar
                percent={g.percentComplete}
                label={t("progress", { percent: g.percentComplete })}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="size-4" aria-hidden="true" />
                {g.dueDate ? d.day(g.dueDate) : t("table.noDate")}
              </span>
              <span className="inline-flex items-center gap-2">
                <Flag className="size-3.5" aria-hidden="true" />
                {g.milestonesTotal > 0
                  ? t("table.milestonesOf", {
                      done: g.milestonesDone,
                      total: g.milestonesTotal,
                    })
                  : t("table.noMilestones")}
              </span>
              <ArrowUpRight
                className="size-4 text-primary"
                aria-hidden="true"
              />
            </div>
          </article>
        ))}
      </div>
      <Pagination
        page={page.page}
        pages={pages}
        hrefFor={hrefForPage}
        labels={{
          nav: t("pagination.label"),
          previous: t("pagination.previous"),
          next: t("pagination.next"),
          position: t("pagination.page", { page: page.page, pages }),
        }}
      />
    </div>
  );
}

export function GoalsOverview({ counts }: { counts: GoalListPage["counts"] }) {
  const t = useTranslations("Goals");
  const x = useTranslations("Experience");
  const total = goalStates.reduce((sum, state) => sum + counts[state], 0);
  return (
    <div className="overview-grid">
      <section className="overview-hero">
        <ProgressRing
          percent={total ? (counts.completed / total) * 100 : 0}
          label={t("overview.completed")}
        />
        <div className="min-w-0">
          <h2 className="text-2xl">{t("overview.completed")}</h2>
          <p className="mt-2 text-sm text-brand-200">
            {x("completedOf", { done: counts.completed, total })}
          </p>
        </div>
      </section>
      <MetricCard
        tone="soft"
        label={t("overview.moving")}
        value={counts.in_progress}
        note={t("overview.movingNote", { n: counts.in_progress })}
        icon={<Target className="size-5" />}
      />
      <MetricCard
        tone="warm"
        label={t("overview.review")}
        value={counts.overdue}
        note={t("overview.reviewNote", { n: counts.overdue })}
        icon={<CalendarDays className="size-5" />}
      />
    </div>
  );
}
