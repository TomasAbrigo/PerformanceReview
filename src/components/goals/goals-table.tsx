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
import { type KpiThresholds, percentTone } from "@/modules/insights/tone";
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
  cycleId,
}: {
  page: GoalListPage;
  showPerson: boolean;
  hrefForPage: (page: number) => string;
  /** The cycle the list is of: its goals open measured at the cycle's cut-off. */
  cycleId?: string;
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
              <Link
                href={
                  cycleId ? `/goals/${g.id}?cycle=${cycleId}` : `/goals/${g.id}`
                }
                className="card-link"
              >
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

/**
 * The head of the list: completed on its ring, in progress and overdue as
 * KPIs. Each value filters the list by its state; overdue carries its tone
 * (a share where less is better, by the thresholds of /settings/insights).
 */
export function GoalsOverview({
  counts,
  thresholds,
  hrefFor,
}: {
  counts: GoalListPage["counts"];
  /** The goals' own target (#133); null: People set none, no tone. */
  thresholds: KpiThresholds | null;
  hrefFor: (state: GoalState) => string;
}) {
  const t = useTranslations("Goals");
  const x = useTranslations("Experience");
  const total = goalStates.reduce((sum, state) => sum + counts[state], 0);
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const overduePct = pct(counts.overdue);
  return (
    <div className="overview-grid">
      <section className="overview-hero">
        <ProgressRing
          percent={pct(counts.completed)}
          label={t("overview.completed")}
        />
        <div className="min-w-0">
          <h2 className="text-2xl">
            <Link
              href={hrefFor("completed")}
              className="text-white underline decoration-brand-400/60 decoration-dotted underline-offset-8 hover:text-brand-200"
            >
              {t("overview.completed")}
            </Link>
          </h2>
          <p className="mt-2 text-sm text-brand-200">
            {x("completedOf", { done: counts.completed, total })}
          </p>
        </div>
      </section>
      <MetricCard
        tone="soft"
        label={t("overview.moving")}
        value={counts.in_progress}
        href={hrefFor("in_progress")}
        note={t("overview.share", { pct: Math.round(pct(counts.in_progress)) })}
        scale={{
          value: pct(counts.in_progress),
          min: 0,
          max: 100,
          label: t("overview.share", {
            pct: Math.round(pct(counts.in_progress)),
          }),
          minLabel: "0 %",
          maxLabel: "100 %",
        }}
        icon={<Target className="size-5" />}
      />
      <MetricCard
        label={t("overview.review")}
        value={counts.overdue}
        href={hrefFor("overdue")}
        status={
          total && thresholds
            ? percentTone(overduePct, thresholds, "down")
            : undefined
        }
        note={t("overview.overdueShare", { pct: Math.round(overduePct) })}
        scale={{
          value: overduePct,
          min: 0,
          max: 100,
          label: t("overview.overdueShare", { pct: Math.round(overduePct) }),
          minLabel: "0 %",
          maxLabel: "100 %",
        }}
        icon={<CalendarDays className="size-5" />}
      />
    </div>
  );
}
