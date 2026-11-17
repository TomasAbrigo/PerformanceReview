import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

async function Redirect({
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
  return null;
}

/** The old leadership view: it moved to /insights/executive (#63). */
export default function ExecutivePage(
  props: PageProps<"/[locale]/dashboards/executive">,
) {
  return (
    <Suspense fallback={<div aria-busy="true" className="h-40" />}>
      <Redirect {...props} />
    </Suspense>
  );
}
