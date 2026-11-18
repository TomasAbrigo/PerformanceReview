import { CardCollection } from "@/components/card-collection";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ProgressBar } from "@/components/progress-bar";
import type { GoalIndicatorRow } from "@/modules/analytics/goals-insights/types";
import { Empty, useDecimal, usePct } from "./shared";

/**
 * The people of the cycle, one dense row each: who and their manager, how
 * many goals and how many are done (a bar), then the average progress, the
 * two indicators and the share of positive comments side by side.
 */
export function PeopleTable({
  rows,
  hrefFor,
}: {
  rows: GoalIndicatorRow[];
  /** The person's assessment, when the actor may open it. */
  hrefFor?: (row: GoalIndicatorRow) => string;
}) {
  const t = useTranslations("GoalsInsights.people");
  const pct = usePct();
  const decimal = useDecimal();
  if (!rows.length) return <Empty />;
  const dash = t("noValue");
  return (
    <CardCollection
      role="group"
      aria-label={t("title")}
      data-testid="people-table"
      gridClassName="dense-list"
      initialCount={10}
    >
      {rows.map((r) => (
        <article
          key={r.participantId}
          className="dense-row dense-row-wide"
          aria-label={r.name}
        >
          <div className="dense-name">
            {hrefFor ? (
              <Link href={hrefFor(r)} className="font-medium">
                {r.name}
              </Link>
            ) : (
              <span className="font-medium">{r.name}</span>
            )}
            <small>
              {t("columns.manager")}: {r.managerName ?? dash}
            </small>
          </div>
          <dl className="dense-bar">
            <dt>
              {t("columns.completed")} · {t("columns.goals")}: {r.goals}
            </dt>
            <dd>
              {r.completedPct === null ? (
                dash
              ) : (
                <ProgressBar
                  percent={r.completedPct}
                  label={t("columns.completed")}
                />
              )}
            </dd>
          </dl>
          <dl className="dense-facts">
            {(
              [
                [
                  "avgProgress",
                  r.avgProgress === null ? dash : `${decimal(r.avgProgress)} %`,
                ],
                ["retention", r.retention ?? dash],
                ["engagement", r.engagement ?? dash],
                [
                  "positive",
                  r.positiveShare === null
                    ? dash
                    : `${pct(r.positiveShare * 100)} %`,
                ],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`columns.${key}`)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </CardCollection>
  );
}

/**
 * The search of the people list: a GET form (`who`), matched on the person's
 * or their manager's name, with how many it shows.
 */
export function PeopleSearch({
  value,
  shown,
  total,
  hidden,
  clearHref,
}: {
  value: string | undefined;
  shown: number;
  total: number;
  /** The other params of the page, kept by the form. */
  hidden: Record<string, string | undefined>;
  clearHref: string;
}) {
  const t = useTranslations("GoalsInsights.people");
  return (
    <form
      method="get"
      action="#goal-people"
      role="search"
      aria-label={t("searchLabel")}
      className="flex flex-wrap items-center gap-3"
    >
      {Object.entries(hidden).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <input
        type="search"
        name="who"
        defaultValue={value ?? ""}
        placeholder={t("search")}
        aria-label={t("search")}
        className="control w-72 max-w-full"
      />
      <span className="text-sm text-muted-foreground" aria-live="polite">
        {t("shown", { n: shown, total })}
      </span>
      {value ? (
        <Link href={clearHref} className="text-sm text-primary underline">
          {t("clear")}
        </Link>
      ) : null}
    </form>
  );
}

/** Whether a row matches the search (person or manager, accents ignored). */
export function matchesPerson(row: GoalIndicatorRow, q: string | undefined) {
  if (!q?.trim()) return true;
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const needle = norm(q.trim());
  return [row.name, row.managerName ?? ""].some((s) =>
    norm(s).includes(needle),
  );
}
