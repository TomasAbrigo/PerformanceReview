"use client";

import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** ES | EN as a small segmented control (the full name is the accessible label). */
export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const current = useLocale();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  return (
    <nav aria-label={t("label")} className="segmented">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={`${pathname}${search ? `?${search}` : ""}`}
          locale={locale}
          aria-label={t(locale)}
          aria-current={locale === current ? "true" : undefined}
          className="text-xs font-medium tracking-wide uppercase"
        >
          {locale}
        </Link>
      ))}
    </nav>
  );
}
