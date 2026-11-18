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
              <th className="pr-4 text-left">{t("table.person")}</th>
              {showPeople ? (
                <>
                  <th className="pr-4 text-left">{t("table.manager")}</th>
                  <th className="pr-4 text-left">{t("table.department")}</th>
                </>
              ) : null}
              <th className="pr-4 text-left">{t("table.self")}</th>
              <th className="pr-4 text-left">{t("table.managerReview")}</th>
              <th className="text-left">{t("table.progress")}</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((r) => (
              <tr key={r.participantId}>
                <th scope="row" className="pr-4 text-left">
                  <Link
                    href={`/assessments/${cycleId}/${r.participantId}`}
                    className="underline"
                  >
                    {r.person.name}
                  </Link>
                  {r.jobTitle ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {r.jobTitle}
                    </span>
                  ) : null}
                </th>
                {showPeople ? (
                  <>
                    <td className="pr-4">
                      {r.manager?.name ?? t("table.noManager")}
                    </td>
                    <td className="pr-4">
                      {r.department ?? t("table.noDepartment")}
                    </td>
                  </>
                ) : null}
                <td className="pr-4">
                  <RequestStateChip state={r.self.state} />
                </td>
                <td className="pr-4">
                  <RequestStateChip state={r.managerReview.state} />
                </td>
                <td>{t(`progress.${r.progress}`)}</td>
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
