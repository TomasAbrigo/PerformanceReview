import { useLocale, useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const current = useLocale();

  return (
    <nav aria-label={t("label")} className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{t("label")}:</span>
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href="/"
          locale={locale}
          aria-current={locale === current ? "true" : undefined}
          className={cn(
            buttonVariants({
              variant: locale === current ? "default" : "outline",
              size: "sm",
            }),
          )}
        >
          {t(locale)}
        </Link>
      ))}
    </nav>
  );
}
