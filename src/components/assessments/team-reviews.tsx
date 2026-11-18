import { useLocale, useTranslations } from "next-intl";
import { CardCollection } from "@/components/card-collection";
import { useDates } from "@/components/dates";
import { Panel } from "@/components/insights/parts";
import { Link } from "@/i18n/navigation";
import { requestState } from "@/modules/assessments/state";
import { cycleName } from "@/modules/review-core/cycle-name";
import type { TeamReview } from "@/modules/review-capture";
import { RequestStateChip } from "./state-chip";

/**
 * The manager's direct reports in the open cycles, as cards: where the
 * person's self assessment stands, where the manager review stands (and
 * whether it was shared) and the link to its form.
 */
export function TeamReviews({ items }: { items: TeamReview[] }) {
  const t = useTranslations("Capture.team");
  const ts = useTranslations("Assessments.detail");
  const d = useDates();
  const locale = useLocale();
  if (items.length === 0) return null;
  return (
    <Panel id="assessments-team" title={t("title")} hint={t("hint")}>
      <CardCollection>
        {items.map((item) => {
          const managerState = requestState(
            { status: item.managerStatus },
            true,
          );
          return (
            <article
              key={item.managerRequestId}
              className="assessment-card"
              aria-labelledby={`team-${item.managerRequestId}`}
            >
              <div className="flex flex-col gap-1">
                <h2 id={`team-${item.managerRequestId}`} className="text-lg">
                  {item.person.name}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {cycleName(
                    { name: item.cycleName, localizedName: item.localizedName },
                    locale,
                  )}
                  {" · "}
                  {item.dueDate
                    ? t("due", { date: d.moment(item.dueDate) })
                    : t("noDue")}
                </span>
              </div>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt>{ts("sides.self")}</dt>
                  <dd>
                    <RequestStateChip state={item.selfState} />
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt>{ts("sides.manager")}</dt>
                  <dd className="flex items-center gap-2">
                    <RequestStateChip state={managerState} />
                    {managerState === "submitted" ? (
                      <span className="text-xs text-muted-foreground">
                        {item.shared ? t("shared") : t("notShared")}
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
              <Link
                href={`/assessments/requests/${item.managerRequestId}`}
                className="button-outline self-start"
              >
                {managerState === "submitted" ? t("view") : t("open")}
              </Link>
            </article>
          );
        })}
      </CardCollection>
    </Panel>
  );
}
