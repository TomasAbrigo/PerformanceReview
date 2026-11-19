import { render, screen, within } from "@testing-library/react";
import { noOrgDims, noOrgOptions } from "@/modules/org-attributes/kinds";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { kpiGroup } from "@/modules/analytics/goals-insights/kpi";
import type {
  GoalIndicatorRow,
  GoalKpis,
  GoalOutliers,
  GoalsVsIndicators,
} from "@/modules/analytics/goals-insights/types";
import { buckets } from "@/modules/analytics/goals-insights/types";
import { BucketsChart } from "./buckets-chart";
import { GoalsFilters } from "./filters";
import { GoalsScatter } from "./goals-scatter";
import { KpisTable } from "./kpis-table";
import { OutliersView } from "./outliers";
import { matchesPerson, PeopleTable } from "./people-table";
import { parseGoalsInsightsParams } from "./url-state";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const messages = { es, en };
const renderIn = (locale: "es" | "en", ui: ReactNode) =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
const locales = ["es", "en"] as const;

const group = (
  key: string | null,
  label: string | null,
  c: { people: number; goals: number; completed: number; overdue?: number },
  others = false,
) =>
  kpiGroup({
    key,
    label,
    others,
    people: c.people,
    peopleWithGoals: c.people,
    goals: c.goals,
    completed: c.completed,
    inProgress: c.goals - c.completed - (c.overdue ?? 0),
    closed: 0,
    overdue: c.overdue ?? 0,
    due: c.completed + (c.overdue ?? 0),
    completedDue: c.completed,
    progressSum: c.completed * 100,
  });

const kpis = (over: Partial<GoalKpis> = {}): GoalKpis => ({
  cycleId: "c1",
  asOf: "2026-09-28",
  groupBy: "department",
  hierarchy: "asOf",
  groups: [
    group("Ing", "Ingeniería", {
      people: 6,
      goals: 26,
      completed: 14,
      overdue: 2,
    }),
    group("Prod", "Producto", { people: 3, goals: 0, completed: 0 }),
  ],
  total: group(null, null, { people: 9, goals: 26, completed: 14, overdue: 2 }),
  suppressed: 0,
  minGroupSize: null,
  ...over,
});

describe("KpisTable", () => {
  it.each(locales)("shows the shares of each group in %s", (locale) => {
    renderIn(locale, <KpisTable kpis={kpis()} />);
    const table = screen.getByTestId("kpis-table");
    const ing = within(table).getByRole("article", { name: /Ingeniería/ });
    // 14 of 26 completed = 54 %, 10 in progress = 38 %, 2 overdue = 8 %, and
    // the 12 that were not completed leave 0 closed: the four add up to 100 %.
    expect(ing).toHaveTextContent("14 (54 %)");
    expect(ing).toHaveTextContent("10 (38 %)");
    expect(ing).toHaveTextContent("2 (8 %)");
    // Against the goals that were due (16 of the 26): 14 of 16 = 88 %.
    expect(ing).toHaveTextContent(
      locale === "es" ? "14 de 16 (88 %)" : "14 of 16 (88 %)",
    );
    const bar = within(ing).getByRole("progressbar", {
      name:
        locale === "es"
          ? /54 % de todos los objetivos completados/
          : /54 % of all goals completed/,
    });
    // The bar draws the same partition as the numbers beside it: completed,
    // in progress (without the overdue), overdue; they fill it exactly.
    const widths = [...bar.children].map((c) =>
      Number.parseFloat((c as HTMLElement).style.width),
    );
    expect(widths.map((w) => Math.round(w))).toEqual([54, 38, 8]);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    // A group without goals has no shares (not 0 %).
    const prod = within(table).getByRole("article", { name: /Producto/ });
    expect(prod).toHaveTextContent(
      locale === "es" ? "Sin objetivos" : "No goals",
    );
    expect(
      within(table).getByRole("article", { name: /Total/ }),
    ).toBeInTheDocument();
  });

  it("labels the Otros cell and says how many people are not shown (direction)", () => {
    renderIn(
      "es",
      <KpisTable
        kpis={kpis({
          groups: [
            group("Ing", "Ingeniería", { people: 6, goals: 10, completed: 5 }),
            group(null, null, { people: 5, goals: 4, completed: 1 }, true),
          ],
          total: null,
          suppressed: 3,
          minGroupSize: 5,
        })}
      />,
    );
    expect(screen.getByRole("article", { name: /Otros/ })).toBeInTheDocument();
    expect(
      screen.getByText(/3 personas en grupos chicos no se muestran/),
    ).toBeInTheDocument();
    // No total: it would give the hidden groups away.
    expect(screen.queryByRole("article", { name: /^Total/ })).toBeNull();
    expect(screen.getByText(/El total se oculta/)).toBeInTheDocument();
  });

  it("direction's teams have a key but no name: numbered, not 'Sin asignar'", () => {
    renderIn(
      "en",
      <KpisTable
        kpis={kpis({
          groupBy: "manager",
          groups: [
            group("m1", null, { people: 6, goals: 10, completed: 5 }),
            group("m2", null, { people: 5, goals: 4, completed: 1 }),
            group(null, null, { people: 5, goals: 4, completed: 1 }, true),
          ],
          total: null,
          minGroupSize: 5,
        })}
      />,
    );
    expect(screen.getByRole("article", { name: /Team 1/ })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Team 2/ })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: /Others/ })).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).toBeNull();
  });

  it("an unnamed group is 'Sin asignar'; nothing at all is the empty message", () => {
    const { unmount } = renderIn(
      "es",
      <KpisTable
        kpis={kpis({
          groups: [group(null, null, { people: 1, goals: 1, completed: 1 })],
        })}
      />,
    );
    expect(
      screen.getByRole("article", { name: /Sin asignar/ }),
    ).toBeInTheDocument();
    unmount();
    renderIn("en", <KpisTable kpis={kpis({ groups: [], total: null })} />);
    expect(
      screen.getByText("There is no data for these filters."),
    ).toBeInTheDocument();
  });
});

const row = (
  name: string,
  over: Partial<GoalIndicatorRow> = {},
): GoalIndicatorRow => ({
  ...noOrgDims,
  participantId: `p-${name}`,
  personId: `person-${name}`,
  name,
  managerId: "m1",
  managerName: "Marta Quiroga",
  department: "Ingeniería",
  goals: 5,
  completed: 4,
  inProgress: 1,
  closed: 0,
  overdue: 0,
  due: 4,
  completedDue: 4,
  progressSum: 460,
  completedPct: 80,
  avgProgress: 92,
  retention: 2,
  engagement: 4,
  positiveShare: 0.5,
  labeledComments: 4,
  ...over,
});

describe("GoalsScatter", () => {
  const rows = [
    row("Ana"),
    row("Bruno", { completedPct: 25, retention: 5 }),
    row("Dario", { goals: 0, completed: 0, completedPct: null }),
    row("Iris", { retention: null }),
  ];

  it.each(locales)(
    "draws a dot per person with goals and the indicator in %s",
    (locale) => {
      const { container } = renderIn(
        locale,
        <GoalsScatter rows={rows} indicator="retention" />,
      );
      // Two visible dots (+ their transparent hit targets): 2 titles.
      expect(container.querySelectorAll("svg title")).toHaveLength(2);
      expect(
        screen.getByText(
          locale === "es"
            ? "Ana: 80 % de objetivos completados, Retención 2"
            : "Ana: 80 % of goals completed, Retention 2",
        ),
      ).toBeInTheDocument();
      // Dario (no goals) and Iris (no retention) have no point; they are counted.
      expect(
        screen.getByText(
          locale === "es"
            ? "2 personas no aparecen por no tener objetivos o esa respuesta."
            : "2 people do not appear for lack of goals or that answer.",
        ),
      ).toBeInTheDocument();
    },
  );

  it("switches to engagement", () => {
    const { container } = renderIn(
      "es",
      <GoalsScatter rows={rows} indicator="engagement" />,
    );
    // Engagement is answered by Ana, Bruno and Iris; Dario has no goals.
    expect(container.querySelectorAll("svg title")).toHaveLength(3);
    expect(
      screen.getByText(/Ana: 80 % de objetivos completados, Compromiso 4/),
    ).toBeInTheDocument();
  });

  it("draws focusable points, axis titles and the reference lines", () => {
    renderIn(
      "es",
      <GoalsScatter
        rows={rows}
        indicator="retention"
        thresholds={{
          goalsHigh: 80,
          goalsLow: 20,
          riskThreshold: 2,
          indicatorHigh: 4,
        }}
      />,
    );
    expect(
      screen.getByRole("img", {
        name: "Ana: 80 % de objetivos completados, Retención 2",
      }),
    ).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Riesgo: 2 o menos")).toBeInTheDocument();
    expect(screen.getByText(/Cumplidos: 80/)).toBeInTheDocument();
    expect(screen.getByText("↑ Retención (1 a 5)")).toBeInTheDocument();
  });

  it("has the points as a table too", () => {
    renderIn("en", <GoalsScatter rows={rows} indicator="retention" />);
    expect(screen.getByText("View as table")).toBeInTheDocument();
  });
});

const vs = (over: Partial<GoalsVsIndicators> = {}): GoalsVsIndicators => ({
  cycleId: "c1",
  rows: [],
  buckets: buckets.map((b, i) => ({
    ...b,
    people: i === 1 ? 3 : i === 4 ? 4 : 0,
    retentionPeople: i === 1 ? 3 : i === 4 ? 4 : 0,
    engagementPeople: i === 1 ? 3 : i === 4 ? 4 : 0,
    meanRetention: i === 1 ? 4 : i === 4 ? 3.5 : null,
    meanEngagement: i === 1 ? 4 : i === 4 ? 3.5 : null,
    meanPositiveShare: i === 1 ? 0.75 : null,
    hidden: false,
  })),
  withoutGoals: 1,
  suppressed: 0,
  minGroupSize: null,
  ...over,
});

describe("BucketsChart", () => {
  it.each(locales)(
    "draws the means of each bucket and counts who is left out in %s",
    (locale) => {
      renderIn(locale, <BucketsChart data={vs()} />);
      const chart = screen.getByRole("group", {
        name:
          locale === "es"
            ? /¿Cambian retención y compromiso según el cumplimiento de objetivos/
            : /Do retention and engagement change with goal completion/,
      });
      expect(chart).toHaveAccessibleName(/20–40 %/);
      expect(chart).toHaveAccessibleName(
        locale === "es" ? /20–40 %, Retención: 4/ : /20–40 %, Retention: 4/,
      );
      // Each bar writes its mean and each bucket its n.
      expect(
        within(chart).getByRole("img", {
          name:
            locale === "es"
              ? "20–40 % · Retención: 4"
              : "20–40 % · Retention: 4",
        }),
      ).toHaveAttribute("tabindex", "0");
      // The n of each bar is the people of the bucket who have that answer.
      expect(within(chart).getByText("n = 3 / 3")).toBeInTheDocument();
      expect(
        screen.getByText(
          locale === "es"
            ? "1 persona sin objetivos no entra en este gráfico."
            : "1 person without goals is not in this chart.",
        ),
      ).toBeInTheDocument();
    },
  );

  it("labels the buckets direction may not see, without numbers", () => {
    renderIn(
      "es",
      <BucketsChart
        data={vs({
          buckets: vs().buckets.map((b) =>
            b.people === 3
              ? {
                  from: b.from,
                  to: b.to,
                  people: null,
                  retentionPeople: null,
                  engagementPeople: null,
                  meanRetention: null,
                  meanEngagement: null,
                  meanPositiveShare: null,
                  hidden: true,
                }
              : b,
          ),
          withoutGoals: null,
          suppressed: 3,
          minGroupSize: 5,
        })}
      />,
    );
    expect(
      screen.getByRole("group", { name: /Oculto: menos de 5 personas/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("3 personas en tramos chicos no se muestran."),
    ).toBeInTheDocument();
  });

  it("says there is no data when nobody has goals", () => {
    renderIn(
      "en",
      <BucketsChart
        data={vs({
          buckets: vs().buckets.map((b) => ({
            ...b,
            people: 0,
            meanRetention: null,
            meanEngagement: null,
            meanPositiveShare: null,
          })),
        })}
      />,
    );
    expect(
      screen.getByText("There is no data for these filters."),
    ).toBeInTheDocument();
  });
});

const outliers = (over: Partial<GoalOutliers> = {}): GoalOutliers => ({
  cycleId: "c1",
  thresholds: {
    goalsHigh: 80,
    goalsLow: 30,
    riskThreshold: 2,
    indicatorHigh: 4,
  },
  doneButLow: {
    count: 1,
    people: [
      {
        participantId: "pa",
        personId: "a",
        name: "Ana Prieto",
        managerId: "m",
        managerName: "Marta Quiroga",
        department: "Ingeniería",
        goals: 5,
        completed: 4,
        completedPct: 80,
        retention: 2,
        engagement: 4,
      },
    ],
  },
  behindButHigh: { count: 0, people: [] },
  minGroupSize: null,
  ...over,
});

describe("OutliersView", () => {
  it.each(locales)(
    "lists the people of each group with a link to their assessment in %s",
    (locale) => {
      renderIn(locale, <OutliersView data={outliers()} />);
      const done = screen.getByTestId("outliers-done-low");
      expect(done).toHaveTextContent(
        locale === "es"
          ? "Completaron 80 % o más de todos sus objetivos del período (hayan vencido o no), pero retención o compromiso están en 2 o menos."
          : "They completed 80 % or more of all their goals of the period (due or not), but retention or engagement is 2 or less.",
      );
      expect(
        within(done).getByTestId("outliers-done-low-count"),
      ).toHaveTextContent(locale === "es" ? "1 persona" : "1 person");
      expect(within(done).getByText("Ana Prieto")).toBeInTheDocument();
      expect(done).toHaveTextContent(
        locale === "es" ? "4 de 5 (80 %)" : "4 of 5 (80 %)",
      );
      const behind = screen.getByTestId("outliers-behind-high");
      expect(behind).toHaveTextContent(
        locale === "es" ? "Ninguna persona" : "Nobody",
      );
      expect(within(behind).queryByRole("table")).toBeNull();
    },
  );

  it("direction gets counts, or a note when they are under the minimum, never people", () => {
    renderIn(
      "es",
      <OutliersView
        data={outliers({
          doneButLow: { count: 6, people: [] },
          behindButHigh: { count: null, people: [] },
          minGroupSize: 5,
        })}
      />,
    );
    expect(screen.getByTestId("outliers-done-low-count")).toHaveTextContent(
      "6 personas",
    );
    expect(screen.getByTestId("outliers-behind-high-count")).toHaveTextContent(
      "Hay menos de 5 personas: no se muestra el número.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("PeopleTable", () => {
  it("shows goals, indicators and positive comments, with dashes where there is none", () => {
    renderIn(
      "es",
      <PeopleTable
        rows={[
          row("Ana"),
          row("Dario", {
            goals: 0,
            completed: 0,
            completedPct: null,
            avgProgress: null,
            positiveShare: null,
            engagement: null,
          }),
        ]}
      />,
    );
    const table = screen.getByTestId("people-table");
    const ana = within(table).getByRole("article", { name: /Ana/ });
    expect(within(ana).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "80",
    );
    expect(ana).toHaveTextContent("92 %");
    expect(ana).toHaveTextContent("50 %");
    const dario = within(table).getByRole("article", { name: /Dario/ });
    expect(dario).toHaveTextContent("–");
  });
});

describe("GoalsFilters", () => {
  const C1 = "8d8d2b72-0c8a-4e7e-bab0-42b903eeff41";
  const C2 = "8d8d2b72-0c8a-4e7e-bab0-42b903eeff42";
  const params = parseGoalsInsightsParams({ cycle: C2 });
  const cycles = [
    { id: C1, name: "H1 2024" },
    { id: C2, name: "H2 2024" },
  ];

  it("offers the cycles (no 'all'), the areas and the managers it was given", () => {
    renderIn(
      "en",
      <GoalsFilters
        params={params}
        cycles={cycles}
        options={{
          departments: ["Ingeniería"],
          managers: [{ id: "m1", name: "Marta" }],
          org: noOrgOptions,
        }}
      />,
    );
    const cycle = screen.getByLabelText("Cycle") as HTMLSelectElement;
    expect(
      within(cycle)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["H1 2024", "H2 2024"]);
    expect(cycle.value).toBe(C2);
    expect(
      within(screen.getByLabelText("Area"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All", "Ingeniería"]);
    expect(
      within(screen.getByLabelText("Manager"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All", "Marta"]);
  });

  it("has no manager picker without managers (direction), and keeps the grouping in the URL", () => {
    const { container } = renderIn(
      "es",
      <GoalsFilters
        params={parseGoalsInsightsParams({ groupBy: "manager" })}
        cycles={cycles}
        options={{
          departments: ["Ingeniería"],
          managers: [],
          org: noOrgOptions,
        }}
      />,
    );
    expect(screen.queryByLabelText("Manager")).toBeNull();
    expect(container.querySelector('input[name="groupBy"]')).toHaveValue(
      "manager",
    );
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeInTheDocument();
  });
});

describe("org cuts in the goals filters", () => {
  it("offers the cuts with values and the grouping by them", () => {
    renderIn(
      "en",
      <GoalsFilters
        params={parseGoalsInsightsParams({ cycle: "c1", santexLead: "Lía" })}
        cycles={[{ id: "c1", name: "H1" }]}
        options={{
          departments: ["Ingeniería"],
          managers: [],
          org: {
            accounts: ["Cuenta A"],
            projects: ["Proyecto A1"],
            dms: [],
            santexLeads: ["Lía"],
          },
        }}
      />,
    );

    expect(screen.getByLabelText("Account")).toBeInTheDocument();
    expect(screen.getByLabelText("Project")).toBeInTheDocument();
    expect(screen.queryByLabelText("DM")).toBeNull();
    expect(screen.getByLabelText("Santex Lead")).toHaveValue("Lía");
  });

  it("the KPI table groups by account", () => {
    const groups = [
      {
        ...kpiGroup({
          key: "Cuenta A",
          label: "Cuenta A",
          people: 3,
          peopleWithGoals: 3,
          goals: 6,
          completed: 3,
          inProgress: 3,
          closed: 0,
          overdue: 0,
          due: 3,
          completedDue: 3,
          progressSum: 300,
        }),
      },
    ];
    renderIn(
      "es",
      <KpisTable
        kpis={{
          cycleId: "c1",
          asOf: "2026-09-28",
          groupBy: "account",
          hierarchy: "asOf",
          groups,
          total: groups[0],
          suppressed: 0,
          minGroupSize: null,
        }}
      />,
    );

    expect(screen.getByTestId("kpis-table")).toHaveTextContent("Cuenta A");
  });
});

describe("goals insights drills", () => {
  it("makes each scatter dot a link to the person's assessment", () => {
    renderIn(
      "es",
      <GoalsScatter
        rows={[row("Ana")]}
        indicator="retention"
        hrefFor={(r) => `/es/assessments/c1/${r.participantId}`}
      />,
    );
    const dot = screen.getByRole("link", { name: /Ana/ });
    expect(dot.getAttribute("href")).toMatch(/^\/es\/assessments\/c1\//);
  });

  it("links the people list's names and finds a person or a manager, accents ignored", () => {
    renderIn(
      "es",
      <PeopleTable rows={[row("Ana")]} hrefFor={() => "/assessments/c1/p"} />,
    );
    expect(screen.getByRole("link", { name: "Ana" })).toHaveAttribute(
      "href",
      "/assessments/c1/p",
    );
    const r = row("Martín Pérez", { managerName: "Lucía" });
    expect(matchesPerson(r, "martin")).toBe(true);
    expect(matchesPerson(r, "lucia")).toBe(true);
    expect(matchesPerson(r, "zoe")).toBe(false);
    expect(matchesPerson(r, undefined)).toBe(true);
  });
});
