import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<"/[locale]/settings">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Settings.nav");

  const links = [
    { href: "/", label: t("home") },
    { href: "/settings/templates", label: t("templates") },
    { href: "/settings/scales", label: t("scales") },
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6">
      <nav
        aria-label={t("label")}
        className="flex flex-wrap gap-2 border-b pb-3"
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  );
}
