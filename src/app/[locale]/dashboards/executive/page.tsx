import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** The old leadership view: it moved to /insights/executive (#63). */
export default async function ExecutivePage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboards/executive">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const { cycle } = await searchParams;
  redirect({
    href:
      typeof cycle === "string" && cycle
        ? `/insights/executive?cycle=${encodeURIComponent(cycle)}`
        : "/insights/executive",
    locale,
  });
}
