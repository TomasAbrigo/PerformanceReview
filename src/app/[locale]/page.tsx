import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const tApp = await getTranslations("App");
  const tHome = await getTranslations("Home");
  const tSettings = await getTranslations("Settings.nav");
  const tPeople = await getTranslations("People");
  const tImports = await getTranslations("Imports");

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-semibold">{tApp("title")}</h1>
          </CardTitle>
          <CardDescription>{tHome("heading")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>{tHome("welcome")}</p>
          <nav aria-label={tHome("settings")} className="flex flex-col gap-1">
            <Link href="/people" className="underline">
              {tPeople("nav")}
            </Link>
            <Link href="/imports/runs" className="underline">
              {tImports("nav")}
            </Link>
            <Link href="/settings/templates" className="underline">
              {tSettings("templates")}
            </Link>
            <Link href="/settings/scales" className="underline">
              {tSettings("scales")}
            </Link>
          </nav>
          <LocaleSwitcher />
        </CardContent>
      </Card>
    </main>
  );
}
