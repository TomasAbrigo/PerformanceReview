import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/** On a historical import run's page: the per-cycle result of the import. */
export function HistoryResultLink({ runId }: { runId: string }) {
  const t = useTranslations("ImportHistory");
  return (
    <Link
      href={`/imports/history/${runId}`}
      className={buttonVariants({ variant: "default" })}
    >
      {t("viewResult")}
    </Link>
  );
}
