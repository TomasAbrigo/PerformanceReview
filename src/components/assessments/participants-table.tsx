import { ArrowUpRight, ClipboardCheck, UserRound, Users } from "lucide-react";
import { EmptyState, IconTile } from "@/components/experience";
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
                showPeople ? "flex flex-col gap-3" : "grid gap-5 sm:grid-cols-2"
              }
            >
              {(
                [
                  {
                    label: t("table.self"),
                    side: r.self,
                    icon: <UserRound className="size-5" />,
                  },
                  {
                    label: t("table.managerReview"),
                    side: r.managerReview,
                    icon: <Users className="size-5" />,
                  },
                ] as const
              ).map(({ label, side, icon }) => (
                <div key={label} className="assessment-perspective">
                  <div className="flex items-center justify-between gap-3">
                    <IconTile>{icon}</IconTile>
                    <RequestStateChip state={side.state} />
                  </div>
                  <h3>{label}</h3>
                  <div className="flex gap-2" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-full ${side.state === "submitted" ? "bg-brand-600" : side.state === "draft" && i === 0 ? "bg-brand-400" : "bg-brand-200/50"}`}
                      />
                    ))}
                  </div>
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
