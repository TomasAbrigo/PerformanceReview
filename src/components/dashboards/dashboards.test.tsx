import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  bins,
  type CycleProgress,
  type ExecutiveSummary,
  type ManagerTeam,
  type PersonTrajectory,
  type RatingDistribution,
  type SelfManagerGap,
} from "@/modules/analytics/dashboards/types";
import { FiltersForm } from "./controls";
import { ExecutiveView } from "./executive-view";
import { parseParams } from "./url-state";

describe("FiltersForm / parseParams", () => {
  it("offers a single 'all cycles' option and blank means all", () => {
    renderIn(
      "en",
      <FiltersForm
        params={parseParams({})}
        cycles={[
          { id: "all", name: "All cycles" },
          { id: "c1", name: "H1" },
        ]}
        options={{
          departments: [],
          managers: [],
          locations: [],
          jobTitles: [],
        }}
      />,
    );
    const cycle = screen.getByLabelText("Cycle");
    expect(
      within(cycle)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All cycles", "H1"]);
    expect(parseParams({ cycle: "" }).cycle).toBe("all");
    expect(parseParams({}).cycle).toBeUndefined();
  });
});
import { GapChart } from "./gap-chart";
import { GoalsScatter } from "./goals-scatter";
import { ProgressChart } from "./progress-chart";
import { RatingHistogram } from "./rating-histogram";
import { TeamView } from "./team-view";
import { TrajectoryChart } from "./trajectory-chart";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
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
const emptyText = { es: /No hay datos/, en: /No data/ };

const progress: CycleProgress = {
  cycleId: "c",
  status: "collecting",
  rows: [
    {
      relationship: "self",
      department: "Ingeniería",
      managerId: "m",
      managerName: "Carla Romero",
      total: 2,
      submitted: 1,
      draft: 1,
      declined: 0,
    },
  ],
  totals: [
    { relationship: "self", total: 2, submitted: 1, draft: 1, declined: 0 },
  ],
};

describe("ProgressChart", () => {
  it.each(locales)("empty and with data (%s)", (locale) => {
    const { unmount } = renderIn(
      locale,
      <ProgressChart data={{ ...progress, rows: [], totals: [] }} />,
    );
    expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
    unmount();
    renderIn(locale, <ProgressChart data={progress} />);
    expect(
      screen.getByRole("img", {
        name:
          locale === "es"
            ? "Autoevaluación: 1 de 2 enviadas"
            : "Self assessment: 1 of 2 submitted",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Carla Romero")).toBeInTheDocument();
  });

  it("aggregateOnly data has no manager column", () => {
    renderIn(
      "es",
      <ProgressChart
        data={{
          ...progress,
          rows: [{ ...progress.rows[0], managerId: null, managerName: null }],
        }}
      />,
    );
    expect(screen.queryByText("Manager")).not.toBeInTheDocument();
  });
});

const dist: RatingDistribution = {
  bins,
  total: [0, 1, 0, 0, 1],
  series: [
    {
      key: "Ingeniería",
      label: "Ingeniería",
      counts: [0, 1, 0, 0, 1],
      n: 2,
      mean: 0.5,
    },
  ],
};

describe("RatingHistogram", () => {
  it.each(locales)("empty and with data (%s)", (locale) => {
    const { unmount } = renderIn(
      locale,
      <RatingHistogram data={{ ...dist, series: [] }} />,
    );
    expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
    unmount();
    renderIn(locale, <RatingHistogram data={dist} />);
    expect(screen.getAllByTestId("histogram")).toHaveLength(1);
    expect(
      screen.getByRole("img", { name: /Ingeniería: 0–20 % 0, 20–40 % 1/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(locale === "es" ? /2 personas/ : /2 people/),
    ).toBeInTheDocument();
  });

  it("aggregateOnly labels the unnamed series as all", () => {
    renderIn(
      "en",
      <RatingHistogram
        aggregateOnly
        data={{
          ...dist,
          series: [{ ...dist.series[0], key: null, label: null }],
        }}
      />,
    );
    expect(screen.getByRole("img", { name: /^All:/ })).toBeInTheDocument();
  });
});

const trajectory: PersonTrajectory = {
  personId: "p",
  personName: "Bruno Pérez",
  points: [
    {
      cycleId: "c1",
      cycleName: "H1 2022",
      periodEnd: "2022-06-30",
      normalized: 2 / 3,
      optionLabel: "Supera a menudo",
      stage: "calibrated",
      managerName: "Carla Romero",
      jobTitle: "Developer",
      department: "Ingeniería",
    },
    {
      cycleId: "c2",
      cycleName: "H1 2024",
      periodEnd: "2024-06-30",
      normalized: null,
      optionLabel: null,
      stage: null,
      managerName: "Ana García",
      jobTitle: "Senior Developer",
      department: "Ingeniería",
    },
  ],
};

describe("TrajectoryChart", () => {
  it.each(locales)("empty and with data (%s)", (locale) => {
    const { unmount } = renderIn(
      locale,
      <TrajectoryChart data={{ ...trajectory, points: [] }} />,
    );
    expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
    unmount();
    renderIn(locale, <TrajectoryChart data={trajectory} />);
    const chart = screen.getByRole("img", { name: /H1 2022: 67 %/ });
    expect(chart).toHaveAccessibleName(
      locale === "es" ? /H1 2024: No publicado/ : /H1 2024: Not published/,
    );
    expect(screen.getByText("Carla Romero")).toBeInTheDocument();
    expect(screen.getByText("Senior Developer")).toBeInTheDocument();
  });
});

const gap: SelfManagerGap = {
  byQuestion: [
    {
      questionRevisionId: "q",
      prompt: { es: "Colaboración", en: "Collaboration" },
      n: 1,
      meanSelf: 0.75,
      meanManager: 0.5,
      meanGap: -0.25,
    },
  ],
  byPerson: [
    {
      participantId: "pp",
      personId: "p",
      name: "Bruno Pérez",
      n: 1,
      meanGap: -0.25,
    },
  ],
};

describe("GapChart", () => {
  it.each(locales)("empty and with data (%s)", (locale) => {
    const { unmount } = renderIn(
      locale,
      <GapChart data={{ byQuestion: [], byPerson: [] }} />,
    );
    expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
    unmount();
    renderIn(locale, <GapChart data={gap} />);
    const label = locale === "es" ? "Colaboración" : "Collaboration";
    expect(
      screen.getByRole("img", { name: new RegExp(`${label}: -25`) }),
    ).toBeInTheDocument();
    expect(screen.getByText("Bruno Pérez")).toBeInTheDocument();
  });
});

describe("GoalsScatter", () => {
  it.each(locales)("empty and with data (%s)", (locale) => {
    const { unmount } = renderIn(locale, <GoalsScatter rows={[]} />);
    expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
    unmount();
    renderIn(
      locale,
      <GoalsScatter
        rows={[
          {
            participantId: "pp",
            personId: "p",
            name: "Bruno Pérez",
            goals: 2,
            completed: 1,
            avgProgress: 75,
            normalized: 2 / 3,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("img", { name: /Bruno Pérez: .* 75 %, .* 67 %/ }),
    ).toBeInTheDocument();
  });
});

const team: ManagerTeam = {
  managerId: "m",
  hierarchy: "asOf",
  members: [
    {
      personId: "p",
      name: "Bruno Pérez",
      depth: 1,
      jobTitle: "Developer",
      department: "Ingeniería",
      participantId: "pp",
      normalized: 0.5,
    },
    {
      personId: "q",
      name: "Dana",
      depth: 2,
      jobTitle: null,
      department: null,
      participantId: null,
      normalized: null,
    },
  ],
};

describe("TeamView", () => {
  it.each(locales)("empty and with data (%s)", (locale) => {
    const { unmount } = renderIn(
      locale,
      <TeamView data={{ ...team, members: [] }} />,
    );
    expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
    unmount();
    renderIn(locale, <TeamView data={team} />);
    expect(screen.getByRole("link", { name: "Bruno Pérez" })).toHaveAttribute(
      "href",
      "/dashboards/people/p",
    );
    expect(
      screen.getByText(locale === "es" ? "No participa" : "Not in cycle"),
    ).toBeInTheDocument();
  });
});

const exec: ExecutiveSummary = {
  minGroupSize: 5,
  participants: 12,
  progress: [{ relationship: "manager", total: 4, submitted: 3 }],
  distribution: [0, 1, 2, 3, 1],
  byDepartment: [
    { department: "Ventas", n: 5, mean: 0.5, counts: [0, 1, 1, 2, 1] },
  ],
  others: { n: 6, mean: 0.4, counts: [0, 1, 2, 2, 1] },
  suppressed: 1,
};

describe("ExecutiveView", () => {
  it.each(locales)("aggregates only, with the minimum group (%s)", (locale) => {
    renderIn(locale, <ExecutiveView data={exec} />);
    expect(screen.getByTestId("exec-participants")).toHaveTextContent("12");
    expect(screen.getByText("75 %")).toBeInTheDocument();
    expect(
      screen.getByText(
        locale === "es"
          ? "Solo agregados: sin nombres ni ids. Los grupos de menos de 5 personas se agrupan en Otros o se ocultan."
          : "Aggregates only: no names or ids. Groups of fewer than 5 people are folded into Others or hidden.",
      ),
    ).toBeInTheDocument();
    // Total, Ventas and Otros.
    const charts = screen.getAllByTestId("histogram");
    expect(charts).toHaveLength(3);
    expect(
      within(charts[0]).getByText(locale === "es" ? "Todos" : "All"),
    ).toBeInTheDocument();
    expect(
      within(charts[2]).getByText(locale === "es" ? "Otros" : "Others"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        locale === "es"
          ? /1 persona en áreas chicas/
          : /1 person in small departments/,
      ),
    ).toBeInTheDocument();
  });

  it.each(locales)("People see no minimum (%s)", (locale) => {
    renderIn(
      locale,
      <ExecutiveView
        data={{ ...exec, minGroupSize: null, others: null, suppressed: 0 }}
      />,
    );
    expect(
      screen.getByText(
        locale === "es"
          ? "Solo agregados: sin nombres ni ids."
          : "Aggregates only: no names or ids.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("histogram")).toHaveLength(2);
    expect(
      screen.queryByText(locale === "es" ? "Otros" : "Others"),
    ).not.toBeInTheDocument();
  });

  it.each(locales)(
    "a cycle under the minimum shows only the head count (%s)",
    (locale) => {
      renderIn(
        locale,
        <ExecutiveView
          data={{
            minGroupSize: 5,
            participants: 3,
            progress: [],
            distribution: [0, 0, 0, 0, 0],
            byDepartment: [],
            others: null,
            suppressed: 3,
          }}
        />,
      );
      expect(screen.getByTestId("exec-participants")).toHaveTextContent("3");
      expect(
        screen.getByText(
          locale === "es"
            ? "Hay menos de 5 participantes: no se muestran datos para proteger a las personas."
            : "There are fewer than 5 participants: no data is shown to protect people.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("histogram")).not.toBeInTheDocument();
    },
  );

  it("with no data still renders zeros", () => {
    renderIn(
      "es",
      <ExecutiveView
        data={{
          minGroupSize: null,
          participants: 0,
          progress: [],
          distribution: [0, 0, 0, 0, 0],
          byDepartment: [],
          others: null,
          suppressed: 0,
        }}
      />,
    );
    expect(screen.getByTestId("exec-participants")).toHaveTextContent("0");
  });
});
