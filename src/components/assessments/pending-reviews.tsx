import { useTranslations } from "next-intl";
import { CardCollection } from "@/components/card-collection";
import { useDates } from "@/components/dates";
import { Panel } from "@/components/insights/parts";
import { Link } from "@/i18n/navigation";

export type PendingItem = {
  requestId: string;
  cycleName: string;
  dueDate: string | null;
};

/** The actor's self assessments still to complete, as cards linking to their form. */
export function PendingReviews({ items }: { items: PendingItem[] }) {
  const t = useTranslations("Capture.pending");
  const d = useDates();
  if (items.length === 0) return null;
  return (
    <Panel id="assessments-pending" title={t("title")} hint={t("hint")}>
      <CardCollection>
        {items.map((item) => (
          <article key={item.requestId} className="assessment-card">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg">{item.cycleName}</h2>
              <span className="text-sm text-muted-foreground">
                {item.dueDate
                  ? t("due", { date: d.moment(item.dueDate) })
                  : t("noDue")}
              </span>
            </div>
            <Link
              href={`/assessments/requests/${item.requestId}`}
              className="button-outline self-start"
            >
              {t("open")}
            </Link>
          </article>
        ))}
      </CardCollection>
    </Panel>
  );
}
