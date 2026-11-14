import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";

/**
 * "Exportar CSV": downloads `/api/v1/export/<file>.csv` with the given
 * filters (empty ones are dropped). A plain anchor: the endpoint is an API
 * route, outside the locale tree.
 */
export function ExportCsvLink({
  file,
  params = {},
}: {
  file: string;
  params?: Record<string, string | undefined>;
}) {
  const t = useTranslations("Common");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return (
    <a
      href={`/api/v1/export/${file}.csv${qs ? `?${qs}` : ""}`}
      download
      className={buttonVariants({ variant: "outline" })}
    >
      {t("exportCsv")}
    </a>
  );
}
