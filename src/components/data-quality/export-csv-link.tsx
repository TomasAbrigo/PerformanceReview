import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";

/**
 * "Exportar CSV": downloads `/api/v1/export/<file>.csv` with the given
 * filters (empty ones are dropped) and the headers in the page's language. A
 * plain anchor: the endpoint is an API route, outside the locale tree.
 *
 * Not offered when `API_TOKEN` is set: a browser download cannot send the
 * bearer token, so the button would save a 401 as a .csv. With a token, use
 * the API directly (README).
 */
export function ExportCsvLink({
  file,
  params = {},
}: {
  file: string;
  params?: Record<string, string | undefined>;
}) {
  const t = useTranslations("Common");
  const locale = useLocale();
  if (process.env.API_TOKEN) return null;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  query.set("locale", locale);
  return (
    <a
      href={`/api/v1/export/${file}.csv?${query}`}
      download
      className={buttonVariants({ variant: "outline" })}
    >
      {t("exportCsv")}
    </a>
  );
}
