/** The icon of a section, resolved to a lucide component on the client. */
export type NavIcon =
  | "executive"
  | "completion"
  | "indicators"
  | "qualitative"
  | "selfAssessment"
  | "goals"
  | "dm360"
  | "engagement"
  | "upload"
  | "imports"
  | "identity"
  | "dataQuality"
  | "insightsSettings";

export type NavItem = {
  key: NavIcon;
  href: string;
  label: string;
  description: string;
};

export type NavGroup = {
  key: "insights" | "data" | "settings";
  title: string;
  items: NavItem[];
};

/** Every message key the navigation reads, so a typed `t` can be handed in. */
export type NavMessageKey =
  | "Home.groups.insights"
  | "Home.groups.data"
  | "Home.groups.settings"
  | `Home.descriptions.${NavIcon}`
  | "Insights.Executive.nav"
  | "Completion.nav"
  | "Indicators.nav"
  | "Qualitative.nav"
  | "Insights.SelfAssessment.nav"
  | "GoalsInsights.nav"
  | "Insights360.nav"
  | "Engagement.nav"
  | "Upload.nav"
  | "Imports.nav"
  | "Identity.nav"
  | "DataQuality.nav"
  | "InsightsSettings.nav";

type Translate = (key: NavMessageKey) => string;

/**
 * The sections of the app, grouped by purpose, in the order the sidebar and
 * the home show them. Data and Settings are People-only, so the other roles
 * do not get them (the screens themselves are gated too).
 */
export function navGroups(t: Translate, hr: boolean): NavGroup[] {
  const groups: NavGroup[] = [
    {
      key: "insights",
      title: t("Home.groups.insights"),
      items: [
        {
          key: "executive",
          href: "/insights/executive",
          label: t("Insights.Executive.nav"),
          description: t("Home.descriptions.executive"),
        },
        {
          key: "completion",
          href: "/insights/completion",
          label: t("Completion.nav"),
          description: t("Home.descriptions.completion"),
        },
        {
          key: "indicators",
          href: "/insights/indicators",
          label: t("Indicators.nav"),
          description: t("Home.descriptions.indicators"),
        },
        {
          key: "qualitative",
          href: "/insights/qualitative",
          label: t("Qualitative.nav"),
          description: t("Home.descriptions.qualitative"),
        },
        {
          key: "selfAssessment",
          href: "/insights/self-assessment",
          label: t("Insights.SelfAssessment.nav"),
          description: t("Home.descriptions.selfAssessment"),
        },
        {
          key: "goals",
          href: "/insights/goals",
          label: t("GoalsInsights.nav"),
          description: t("Home.descriptions.goals"),
        },
        {
          key: "dm360",
          href: "/insights/360",
          label: t("Insights360.nav"),
          description: t("Home.descriptions.dm360"),
        },
        {
          key: "engagement",
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
        items: [
          {
            key: "upload",
            href: "/imports/upload",
            label: t("Upload.nav"),
            description: t("Home.descriptions.upload"),
          },
          {
            key: "imports",
            href: "/imports/runs",
            label: t("Imports.nav"),
            description: t("Home.descriptions.imports"),
          },
          {
            key: "identity",
            href: "/imports/identity",
            label: t("Identity.nav"),
            description: t("Home.descriptions.identity"),
          },
          {
            key: "dataQuality",
            href: "/data-quality",
            label: t("DataQuality.nav"),
            description: t("Home.descriptions.dataQuality"),
          },
        ],
      },
      {
        key: "settings",
        title: t("Home.groups.settings"),
        items: [
          {
            key: "insightsSettings",
            href: "/settings/insights",
            label: t("InsightsSettings.nav"),
            description: t("Home.descriptions.insightsSettings"),
          },
        ],
      },
    );
  }
  return groups;
}
