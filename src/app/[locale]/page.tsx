import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
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
import { actorIsHr } from "@/modules/actor/server";

type NavGroup = {
  key: string;
  title: string;
  links: { href: string; label: string; description: string }[];
};

/**
 * Navigation grouped by purpose. Data and Settings are People-only screens, so
 * the other roles do not see them (the screens themselves are gated too).
 */
async function HomeNav() {
  const t = await getTranslations();
  const hr = await actorIsHr();

  const groups: NavGroup[] = [
    {
      key: "insights",
      title: t("Home.groups.insights"),
      links: [
        {
          href: "/insights/executive",
          label: t("Insights.Executive.nav"),
          description: t("Home.descriptions.executive"),
        },
        {
          href: "/insights/completion",
          label: t("Completion.nav"),
          description: t("Home.descriptions.completion"),
        },
        {
          href: "/insights/indicators",
          label: t("Indicators.nav"),
          description: t("Home.descriptions.indicators"),
        },
        {
          href: "/insights/qualitative",
          label: t("Qualitative.nav"),
          description: t("Home.descriptions.qualitative"),
        },
        {
          href: "/insights/self-assessment",
          label: t("Insights.SelfAssessment.nav"),
          description: t("Home.descriptions.selfAssessment"),
        },
        {
          href: "/insights/goals",
          label: t("GoalsInsights.nav"),
          description: t("Home.descriptions.goals"),
        },
        {
          href: "/insights/360",
          label: t("Insights360.nav"),
          description: t("Home.descriptions.dm360"),
        },
        {
          href: "/insights/engagement",
          label: t("Engagement.nav"),
          description: t("Home.descriptions.engagement"),
        },
      ],
    },
  ];

  if (hr) {
    groups.push(
      {
        key: "data",
        title: t("Home.groups.data"),
        links: [
          {
            href: "/imports/upload",
            label: t("Upload.nav"),
            description: t("Home.descriptions.upload"),
          },
          {
            href: "/imports/runs",
            label: t("Imports.nav"),
            description: t("Home.descriptions.imports"),
          },
          {
            href: "/imports/identity",
            label: t("Identity.nav"),
            description: t("Home.descriptions.identity"),
          },
          {
            href: "/data-quality",
            label: t("DataQuality.nav"),
            description: t("Home.descriptions.dataQuality"),
          },
        ],
      },
      {
        key: "settings",
        title: t("Home.groups.settings"),
        links: [
          {
            href: "/settings/insights",
            label: t("InsightsSettings.nav"),
            description: t("Home.descriptions.insightsSettings"),
          },
        ],
      },
    );
  }

  return (
    <nav aria-label={t("Home.navigation")} className="flex flex-col gap-6">
      {groups.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`home-group-${group.key}`}
          className="flex flex-col gap-2"
        >
          <h2
            id={`home-group-${group.key}`}
            className="text-sm font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {group.title}
          </h2>
          <ul className="flex flex-col gap-3">
            {group.links.map((link) => (
              <li key={link.href} className="flex flex-col">
                <Link href={link.href} className="font-medium underline">
                  {link.label}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {link.description}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const tApp = await getTranslations("App");
  const tHome = await getTranslations("Home");

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-semibold">{tApp("title")}</h1>
          </CardTitle>
          <CardDescription>{tHome("heading")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <p>{tHome("welcome")}</p>
          <Suspense fallback={<div aria-busy="true" className="h-64" />}>
            <HomeNav />
          </Suspense>
          <LocaleSwitcher />
        </CardContent>
      </Card>
    </main>
  );
}
