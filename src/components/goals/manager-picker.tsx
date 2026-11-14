import { useTranslations } from "next-intl";
import { ExportCsvLink } from "@/components/data-quality/export-csv-link";
import { Link } from "@/i18n/navigation";

/**
 * Temporary stand-in for the "act as" selector: pick whose team to see.
 * Goes away once the signed-in manager is known.
 */
export function ManagerPicker({
  managers,
}: {
  managers: { id: string; displayName: string }[];
}) {
  const t = useTranslations("Goals.team");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <ExportCsvLink file="goals" />
      </div>
      {managers.length === 0 ? (
        <p>{t("noManagers")}</p>
      ) : (
        <>
          <p className="text-muted-foreground">{t("chooseManager")}</p>
          <ul className="flex flex-col gap-1">
            {managers.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/team/goals?manager=${m.id}`}
                  className="hover:underline"
                >
                  {m.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
