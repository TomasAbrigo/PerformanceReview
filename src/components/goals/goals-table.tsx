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
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {t("empty")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table aria-label={t("table.label")}>
          <thead>
            <tr>
              <th className="pr-4 text-left">{t("table.goal")}</th>
              {showPerson ? (
                <th className="pr-4 text-left">{t("table.person")}</th>
              ) : null}
              <th className="pr-4 text-left">{t("table.state")}</th>
              <th className="pr-4 text-left">{t("table.progress")}</th>
              <th className="pr-4 text-left">{t("table.due")}</th>
              <th className="text-left">{t("table.milestones")}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((g) => (
              <tr key={g.id}>
                <th scope="row" className="pr-4 text-left">
                  <Link href={`/goals/${g.id}`} className="underline">
                    {g.title}
                  </Link>
                </th>
                {showPerson ? (
                  <td className="pr-4">
                    {g.person.name}
                    {g.department ? (
                      <span className="block text-xs text-muted-foreground">
                        {g.department}
                      </span>
                    ) : null}
                  </td>
                ) : null}
                <td className="pr-4">
                  <GoalStateBadge state={g.state} />
                </td>
                <td className="pr-4">
                  <ProgressBar
                    percent={g.percentComplete}
                    label={t("progress", { percent: g.percentComplete })}
                  />
                </td>
                <td className="pr-4 whitespace-nowrap tabular-nums">
                  {g.dueDate ? d.day(g.dueDate) : t("table.noDate")}
                </td>
                <td className="tabular-nums">
                  {g.milestonesTotal > 0
                    ? t("table.milestonesOf", {
                        done: g.milestonesDone,
                        total: g.milestonesTotal,
                      })
                    : t("table.noMilestones")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
