import { individualScope } from "@/modules/actor/individual-scope";
import type { ActorContext } from "@/modules/actor/types";
import { insightsScope } from "@/modules/insights/authz";

/** The icon of a section, resolved to a lucide component on the client. */
export type NavIcon =
  | "goalsArea"
  | "assessmentsArea"
  | "executive"
  | "completion"
  | "indicators"
  | "qualitative"
  | "selfAssessment"
  | "goalsInsights"
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

export type NavGroupKey =
  "goals" | "assessments" | "insights" | "data" | "settings";

export type NavGroup = {
  key: NavGroupKey;
  title: string;
  /**
   * What people come for (Goals, Assessments): a single entry shown big, on
   * its own, above the analysis, never mixed with it.
   */
  primary: boolean;
  items: NavItem[];
};

/** Every message key the navigation reads, so a typed `t` can be handed in. */
export type NavMessageKey =
  | `Home.groups.${NavGroupKey}`
  | `Home.descriptions.${NavIcon}`
  | "Goals.nav"
  | "Assessments.nav"
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
 * The sections of the app, in the order the sidebar and the home show them:
 * Goals and Assessments (the data people respond and set, per person), then
 * the Analysis (aggregated, never mixed with them), then Data and Settings.
 * Each role gets what it may open: Goals and Assessments need individual
 * access (not direction, not a manager or employee without a person), the
 * Analysis needs an analysis scope (not employees) and Data and Settings are
 * People-only. The screens themselves are gated too.
 */
export function navGroups(t: Translate, actor: ActorContext): NavGroup[] {
  const item = (key: NavIcon, href: string, label: NavMessageKey): NavItem => ({
    key,
    href,
    label: t(label),
    description: t(`Home.descriptions.${key}`),
  });
  const group = (
    key: NavGroupKey,
    items: NavItem[],
    primary = false,
  ): NavGroup => ({ key, title: t(`Home.groups.${key}`), primary, items });

  const groups: NavGroup[] = [];
  if (individualScope(actor).kind !== "none") {
    groups.push(
      group("goals", [item("goalsArea", "/goals", "Goals.nav")], true),
      group(
        "assessments",
        [item("assessmentsArea", "/assessments", "Assessments.nav")],
        true,
      ),
    );
  }
  if (insightsScope(actor).kind !== "none") {
    groups.push(
      group("insights", [
        item("executive", "/insights/executive", "Insights.Executive.nav"),
        item("completion", "/insights/completion", "Completion.nav"),
        item("indicators", "/insights/indicators", "Indicators.nav"),
        item("qualitative", "/insights/qualitative", "Qualitative.nav"),
        item(
          "selfAssessment",
          "/insights/self-assessment",
          "Insights.SelfAssessment.nav",
        ),
        item("goalsInsights", "/insights/goals", "GoalsInsights.nav"),
        item("dm360", "/insights/360", "Insights360.nav"),
        item("engagement", "/insights/engagement", "Engagement.nav"),
      ]),
    );
  }
  if (actor.role === "hr") {
    groups.push(
      group("data", [
        item("upload", "/imports/upload", "Upload.nav"),
        item("imports", "/imports/runs", "Imports.nav"),
        item("identity", "/imports/identity", "Identity.nav"),
        item("dataQuality", "/data-quality", "DataQuality.nav"),
      ]),
      group("settings", [
        item("insightsSettings", "/settings/insights", "InsightsSettings.nav"),
      ]),
    );
  }
  return groups;
}
