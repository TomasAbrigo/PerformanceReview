import { ArrowUpRight, ClipboardCheck, UserRound, Users } from "lucide-react";
import { EmptyState, MetricCard, ProgressRing } from "@/components/experience";
import { type KpiThresholds, percentTone } from "@/modules/insights/tone";
import { useTranslations } from "next-intl";
import { CountChips } from "@/components/count-chips";
import { Pagination } from "@/components/pagination";
import { Link } from "@/i18n/navigation";
import type { AssessmentListPage } from "@/modules/assessments";
import { type Progress, progressValues } from "@/modules/assessments/state";
import { RequestStateChip } from "./state-chip";

/** The counts per progress, each a link that filters the list by it. */
export function ProgressChips({
  counts,
  current,
  hrefFor,
}: {
  counts: AssessmentListPage["counts"];
  current: Progress | undefined;
  hrefFor: (progress: Progress | undefined) => string;
}) {
  const t = useTranslations("Assessments");
  return (
    <CountChips
      label={t("summary")}
      all={{
        label: t("filters.anyProgress"),
        count: progressValues.reduce((sum, v) => sum + counts[v], 0),
      }}
      items={progressValues.map((v) => ({
        value: v,
        label: t(`progress.${v}`),
        count: counts[v],
      }))}
      current={current}
      hrefFor={hrefFor}
    />
  );
}

/**
 * One row per participant of the cycle: who, their manager and area at the
 * cycle's snapshot, where the self and the manager assessment stand, and the
 * link to their form.
 */
export function ParticipantsTable({
  cycleId,
  page,
  showPeople,
  hrefForPage,
}: {
  cycleId: string;
  page: AssessmentListPage;
  /** False when every row is the actor themself (no manager/area columns to compare). */
  showPeople: boolean;
  hrefForPage: (page: number) => string;
}) {
  const t = useTranslations("Assessments");
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  if (page.items.length === 0) {
    return <EmptyState>{t("empty")}</EmptyState>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        className={showPeople ? "goal-grid" : "grid gap-6"}
        aria-label={t("table.label")}
      >
        {page.items.map((r) => (
          <article
            key={r.participantId}
            className="assessment-card"
            aria-labelledby={`participant-${r.participantId}`}
          >
            <header className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="person-avatar" aria-hidden="true">
                  {r.person.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div>
                  <h2 id={`participant-${r.participantId}`} className="text-xl">
                    <Link
                      className="card-link"
                      href={`/assessments/${cycleId}/${r.participantId}`}
                    >
                      {r.person.name}
                    </Link>
                  </h2>
                  {r.jobTitle ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.jobTitle}
                    </p>
                  ) : null}
                </div>
              </div>
              <ArrowUpRight
                className="size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
            </header>
            {showPeople ? (
              <p className="text-xs text-muted-foreground">
                {r.department ?? t("table.noDepartment")} ·{" "}
                {r.manager?.name ?? t("table.noManager")}
              </p>
            ) : null}
            <div
              className={
                showPeople ? "flex flex-col gap-2" : "grid gap-3 sm:grid-cols-2"
              }
            >
              {(
                [
                  {
                    label: t("table.self"),
                    side: r.self,
                    icon: <UserRound className="size-4" />,
                  },
                  {
                    label: t("table.managerReview"),
                    side: r.managerReview,
                    icon: <Users className="size-4" />,
                  },
                ] as const
              ).map(({ label, side, icon }) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 rounded-lg bg-brand-fog/60 px-3 py-2 text-sm"
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="text-brand-700" aria-hidden="true">
                      {icon}
                    </span>
                    {label}
                  </span>
                  <RequestStateChip state={side.state} />
                </div>
              ))}
            </div>
            <p className="mt-auto inline-flex items-center gap-2 text-sm text-primary">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              {t(`progress.${r.progress}`)}
            </p>
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
 * The head of the list: the share of participants with both perspectives in
 * (on its ring, with its tone) and the partial and pending ones as KPIs, each
 * filtering the list by that progress.
 */
export function ProgressOverview({
  cycleName,
  counts,
  thresholds,
  hrefFor,
}: {
  cycleName: string;
  counts: AssessmentListPage["counts"];
  thresholds: KpiThresholds;
  hrefFor: (progress: Progress) => string;
}) {
  const t = useTranslations("Assessments");
  const x = useTranslations("Experience");
  const total = counts.complete + counts.partial + counts.pending;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const scale = (n: number, label: string) => ({
    value: pct(n),
    min: 0,
    max: 100,
    label,
    minLabel: "0 %",
    maxLabel: "100 %",
  });
  const completeTone = total
    ? percentTone(pct(counts.complete), thresholds)
    : undefined;
  return (
    <div className="overview-grid">
      <section className="overview-hero" data-tone={completeTone}>
        <ProgressRing
          percent={pct(counts.complete)}
          label={t("overview.complete", { pct: pct(counts.complete) })}
        />
        <div className="min-w-0">
          <h2 className="text-xl">{cycleName}</h2>
          <p className="mt-2 text-sm text-brand-200">
            <Link
              href={hrefFor("complete")}
              className="text-white underline decoration-dotted underline-offset-4"
            >
              {t("overview.completeOf", { done: counts.complete, total })}
            </Link>
          </p>
          {completeTone ? (
            <span
              className="tone-pill mt-3 inline-flex"
              data-tone={completeTone}
            >
              {x(`tone.${completeTone}`)}
            </span>
          ) : null}
        </div>
      </section>
      <MetricCard
        label={t("progress.partial")}
        value={counts.partial}
        href={hrefFor("partial")}
        note={t("overview.partialNote", { pct: pct(counts.partial) })}
        scale={scale(
          counts.partial,
          t("overview.partialNote", { pct: pct(counts.partial) }),
        )}
        icon={<ClipboardCheck className="size-5" />}
      />
      <MetricCard
        label={t("progress.pending")}
        value={counts.pending}
        href={hrefFor("pending")}
        status={
          total
            ? percentTone(pct(counts.pending), thresholds, "down")
            : undefined
        }
        note={t("overview.pendingNote", { pct: pct(counts.pending) })}
        scale={scale(
          counts.pending,
          t("overview.pendingNote", { pct: pct(counts.pending) }),
        )}
        icon={<Users className="size-5" />}
      />
    </div>
  );
}
