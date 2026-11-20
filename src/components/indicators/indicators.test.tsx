import { render, screen, within } from "@testing-library/react";
import { noOrgOptions } from "@/modules/org-attributes/kinds";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type {
  IndicatorAlerts,
  IndicatorDistribution,
  IndicatorTrend,
  RiskMatrix,
} from "@/modules/analytics/indicators/types";
import { bands } from "@/modules/analytics/indicators/types";
import { AlertsView } from "./alerts-view";
import { DistributionView } from "./distribution-view";
import { IndicatorFiltersForm } from "./filters";
import { RiskMatrixView } from "./risk-matrix-view";
import { TrendChart } from "./trend-chart";
import { TrendPicker } from "./trend-picker";
import { parseIndicatorParams, parseTrendParams } from "./url-state";

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

const series = (
  key: string | null,
  counts: number[],
  others = false,
): IndicatorDistribution["series"][number] => {
  const n = counts.reduce((a, b) => a + b, 0);
  const sum = counts.reduce((a, c, i) => a + c * (i + 1), 0);
  return { key, label: key, others, counts, n, mean: n ? sum / n : null };
};

const distribution: IndicatorDistribution = {
  cycleId: "c",
  indicator: "retention",
  groupBy: "department",
  series: [
    series("Ingeniería", [1, 2, 1, 1, 1]),
    series("Producto", [0, 1, 0, 1, 1]),
  ],
  total: series(null, [1, 3, 1, 2, 2]),
  suppressed: 0,
  minGroupSize: null,
};

describe("DistributionView", () => {
  it.each(locales)(
    "a histogram per group, the total and a table (%s)",
    (locale) => {
      renderIn(locale, <DistributionView data={distribution} />);
      // The total plus the two groups.
      expect(screen.getAllByTestId("indicator-histogram")).toHaveLength(3);
      const group = screen
        .getAllByTestId("indicator-histogram")
        .find((r) => r.textContent?.includes("Ingeniería"))!;
      // Total first, then the groups with the biggest low (1-2) share.
      expect(screen.getAllByTestId("indicator-histogram")[0]).toHaveTextContent(
        locale === "es" ? "Todos" : "All",
      );
      expect(group.textContent?.replace(/\s/g, " ")).toContain(
        locale === "es" ? "n = 6 · x̄ 2,8" : "n = 6 · x̄ 2.8",
      );
      expect(
        within(group).getByRole("img", {
          name:
            locale === "es"
              ? /^Ingeniería · valor 2: 2 \(33\s%\)$/
              : /^Ingeniería · value 2: 2 \(33%\)$/,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(locale === "es" ? "Ver como tabla" : "View as table"),
      ).toBeInTheDocument();
    },
  );

  it.each(locales)(
    "empty, and the people hidden by the minimum (%s)",
    (locale) => {
      const { unmount } = renderIn(
        locale,
        <DistributionView
          data={{ ...distribution, series: [], total: null }}
        />,
      );
      expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
      unmount();
      renderIn(
        locale,
        <DistributionView
          data={{
            ...distribution,
            series: [series("Ingeniería", [1, 2, 1, 1, 1])],
            total: null,
            suppressed: 3,
            minGroupSize: 5,
          }}
        />,
      );
      expect(screen.getAllByTestId("indicator-histogram")).toHaveLength(1);
      expect(
        screen.getByText(
          locale === "es"
            ? "3 personas están en grupos de menos de 5 y no se muestran"
            : "3 people are in groups smaller than 5 and are not shown",
        ),
      ).toBeInTheDocument();
    },
  );

  it("the 'others' bucket and an unassigned group have their own labels", () => {
    renderIn(
      "en",
      <DistributionView
        data={{
          ...distribution,
          series: [
            { ...series(null, [0, 0, 5, 0, 0]), label: null },
            series(null, [1, 1, 1, 1, 1], true),
          ],
          total: null,
        }}
      />,
    );
    const figures = screen.getAllByTestId("indicator-histogram");
    // "Others" has more low answers, so it goes first.
    expect(within(figures[0]).getByText("Others")).toBeInTheDocument();
    expect(within(figures[1]).getByText("Unassigned")).toBeInTheDocument();
  });

  it("a single series without grouping is called 'All' and not repeated", () => {
    renderIn(
      "es",
      <DistributionView
        data={{
          ...distribution,
          groupBy: "none",
          series: [series(null, [1, 3, 1, 2, 2])],
        }}
      />,
    );
    const figures = screen.getAllByTestId("indicator-histogram");
    expect(figures).toHaveLength(1);
    expect(within(figures[0]).getByText("Todos")).toBeInTheDocument();
  });
});

const cells = (counts: Record<string, number | null>) =>
  bands.flatMap((retention) =>
    bands.map((engagement) => {
      const key = `${retention}:${engagement}`;
      return {
        retention,
        engagement,
        count: key in counts ? counts[key] : 0,
        risk: retention === "low" && engagement === "low",
      };
    }),
  );

const person = {
  personId: "p1",
  name: "Fabio Luna",
  managerId: "m1",
  managerName: "Marta Quiroga",
  department: "Ingeniería",
  retention: 1,
  engagement: 1,
};

const matrix: RiskMatrix = {
  cycleId: "c",
  riskThreshold: 2,
  cells: cells({ "low:low": 3, "high:high": 2, "mid:mid": 1 }),
  total: 6,
  riskCount: 3,
  atRisk: [person],
  suppressed: false,
  minGroupSize: null,
};

describe("RiskMatrixView", () => {
  it.each(locales)(
    "counts per cell, the risk cell and the list for People (%s)",
    (locale) => {
      renderIn(locale, <RiskMatrixView matrix={matrix} />);
      expect(screen.getByTestId("matrix-summary")).toHaveTextContent(
        locale === "es"
          ? "6 personas con ambos indicadores · En riesgo: 3"
          : "6 people with both indicators · At risk: 3",
      );
      const chart = screen.getByRole("img", {
        name: new RegExp(
          locale === "es"
            ? "Retención Bajo, compromiso Bajo: 3 personas"
            : "Retention Low, engagement Low: 3 people",
        ),
      });
      expect(chart).toBeInTheDocument();
      // The risk cell is named, not just coloured; the axes are titled.
      expect(chart).toHaveTextContent(
        locale === "es" ? "En riesgo" : "At risk",
      );
      expect(
        screen.getByText(locale === "es" ? "Retención →" : "Retention →"),
      ).toBeInTheDocument();
      const list = screen.getByTestId("risk-list");
      expect(
        within(list).getByRole("link", { name: "Fabio Luna" }),
      ).toHaveAttribute("href", "/insights/indicators/trend?person=p1");
      expect(within(list).getByText(/Marta Quiroga/)).toBeInTheDocument();
    },
  );

  it("without the list (direction) there is no list and no names", () => {
    renderIn("es", <RiskMatrixView matrix={{ ...matrix, atRisk: null }} />);
    expect(screen.queryByTestId("risk-list")).not.toBeInTheDocument();
    expect(screen.queryByText("Fabio Luna")).not.toBeInTheDocument();
  });

  it.each(locales)("direction: hidden cells and total (%s)", (locale) => {
    renderIn(
      locale,
      <RiskMatrixView
        matrix={{
          ...matrix,
          cells: cells({ "low:low": null, "high:high": null }),
          total: null,
          riskCount: null,
          atRisk: null,
          suppressed: true,
          minGroupSize: 5,
        }}
      />,
    );
    expect(screen.getByTestId("matrix-summary")).toHaveTextContent(
      locale === "es" ? "Total no disponible" : "Total not available",
    );
    expect(
      screen.getByText(
        locale === "es"
          ? "Las celdas con menos de 5 personas no se muestran, ni las que permitirían calcularlas restando del total."
          : "Cells with fewer than 5 people are not shown, nor the ones that would let them be worked out from the total.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("img", {
        name: new RegExp(
          locale === "es" ? "menos de 5 personas" : "fewer than 5 people",
        ),
      }),
    ).toHaveLength(2);
  });

  it.each(locales)("nobody at risk and an empty cycle (%s)", (locale) => {
    const { unmount } = renderIn(
      locale,
      <RiskMatrixView matrix={{ ...matrix, atRisk: [] }} />,
    );
    expect(
      screen.getByText(
        locale === "es"
          ? "Nadie está en el cuadrante de riesgo."
          : "Nobody is in the risk quadrant.",
      ),
    ).toBeInTheDocument();
    unmount();
    renderIn(
      locale,
      <RiskMatrixView
        matrix={{
          ...matrix,
          cells: cells({}),
          total: 0,
          riskCount: 0,
          atRisk: [],
        }}
      />,
    );
    expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
  });
});

const alerts: IndicatorAlerts = {
  cycleId: "c",
  dropThreshold: 2,
  riskThreshold: 2,
  peopleWithDrop: 1,
  peopleAtRisk: 1,
  peopleWithAlert: 1,
  previousCycleId: "c0",
  previousCycle: { name: "H1 2024", localizedName: null },
  minGroupSize: null,
  alerts: [
    { kind: "risk", person, retention: 1, engagement: 1 },
    {
      kind: "drop",
      indicator: "engagement",
      person,
      previousCycleId: "c0",
      previousCycleName: "H1 2024",
      previousValue: 4,
      value: 1,
      delta: 3,
    },
  ],
};

describe("AlertsView", () => {
  it.each(locales)(
    "lists the risks and the falls with the person (%s)",
    (locale) => {
      renderIn(locale, <AlertsView data={alerts} />);
      expect(screen.getByTestId("alerts-summary")).toHaveTextContent(
        locale === "es"
          ? "Personas con caída: 1 · Personas en riesgo: 1"
          : "People with a fall: 1 · People at risk: 1",
      );
      const rows = within(screen.getByTestId("alerts-table")).getAllByRole(
        "article",
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent(locale === "es" ? "Riesgo" : "Risk");
      expect(rows[0]).toHaveTextContent(
        locale === "es"
          ? "Retención 1, compromiso 1"
          : "Retention 1, engagement 1",
      );
      expect(rows[1]).toHaveTextContent(locale === "es" ? "Caída" : "Fall");
      expect(rows[1]).toHaveTextContent(
        locale === "es"
          ? "Compromiso: 4 → 1 (−3) desde H1 2024"
          : "Engagement: 4 → 1 (−3) since H1 2024",
      );
      expect(
        within(rows[0]).getByRole("link", { name: "Fabio Luna" }),
      ).toHaveAttribute("href", "/insights/indicators/trend?person=p1");
    },
  );

  it.each(locales)(
    "names the previous cycle as the screens do and counts people apart from alerts (%s)",
    (locale) => {
      renderIn(
        locale,
        <AlertsView
          data={{
            ...alerts,
            previousCycle: {
              name: "Evaluación semestral 2025-03-29 – 2025-09-28",
              localizedName: null,
            },
          }}
          context={{
            base: { pathname: "/insights/indicators", query: {} },
            targets: { goodPct: 80, watchPct: 50 },
            total: 10,
          }}
        />,
      );
      const month = locale === "es" ? "mar – sept 2025" : "Mar – Sep 2025";
      expect(screen.getByTestId("alerts-kpi-drop")).toHaveTextContent(month);
      expect(screen.getByTestId("alerts-table")).toHaveTextContent(month);
      expect(screen.getByTestId("alerts-table")).not.toHaveTextContent(
        "2025-03-29",
      );
      expect(
        screen.getByText(
          locale === "es"
            ? /Ver las 2 alertas \(1 persona;/
            : /See the 2 alerts \(1 person;/,
        ),
      ).toBeInTheDocument();
    },
  );

  it.each(locales)("no alerts; direction sees counts only (%s)", (locale) => {
    const { unmount } = renderIn(
      locale,
      <AlertsView
        data={{ ...alerts, alerts: [], peopleWithDrop: 0, peopleAtRisk: 0 }}
      />,
    );
    expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
    unmount();
    renderIn(
      locale,
      <AlertsView
        data={{
          ...alerts,
          alerts: [],
          peopleWithDrop: 7,
          peopleAtRisk: null,
          minGroupSize: 5,
        }}
      />,
    );
    expect(screen.getByTestId("alerts-summary")).toHaveTextContent(
      locale === "es"
        ? "Personas con caída: 7 · Personas en riesgo: menos de 5"
        : "People with a fall: 7 · People at risk: fewer than 5",
    );
    expect(screen.queryByTestId("alerts-table")).not.toBeInTheDocument();
  });
});

const trend: IndicatorTrend = {
  indicator: "retention",
  subject: { kind: "all" },
  minGroupSize: null,
  points: [
    {
      cycleId: "c1",
      cycleName: "H1 2024",
      periodStart: "2024-01-01",
      n: 6,
      mean: 3.5,
      counts: [0, 1, 2, 2, 1],
      suppressed: false,
    },
    {
      cycleId: "c2",
      cycleName: "H2 2024",
      periodStart: "2024-07-01",
      n: 9,
      mean: 28 / 9,
      counts: [1, 3, 1, 2, 2],
      suppressed: false,
    },
  ],
};

describe("TrendChart", () => {
  it.each(locales)("a line through the means with a table (%s)", (locale) => {
    renderIn(locale, <TrendChart data={trend} subject="Equipo" />);
    expect(
      screen.getByRole("group", {
        name:
          locale === "es"
            ? "Retención por ciclo, Equipo: H1 2024: 3,5, H2 2024: 3,1"
            : "Retention by cycle, Equipo: H1 2024: 3.5, H2 2024: 3.1",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("H2 2024").length).toBeGreaterThan(0);
  });

  it("a suppressed cycle is a gap: the line is not drawn across it", () => {
    const point = (n: number, mean: number | null) => ({
      cycleId: `c${n}`,
      cycleName: `C${n}`,
      periodStart: `2024-0${n}-01`,
      n: mean === null ? null : 5,
      mean,
      counts: mean === null ? null : [0, 0, 5, 0, 0],
      suppressed: mean === null,
    });
    renderIn(
      "en",
      <TrendChart
        data={{
          ...trend,
          minGroupSize: 5,
          points: [point(1, 3), point(2, null), point(3, 3), point(4, 4)],
        }}
        subject="Producto"
      />,
    );
    const d = screen.getByTestId("trend-line-path").getAttribute("d")!;
    // Two strokes: C1 alone, then C3 to C4.
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(1);
  });

  it.each(locales)("empty, and cycles hidden by the minimum (%s)", (locale) => {
    const { unmount } = renderIn(
      locale,
      <TrendChart data={{ ...trend, points: [] }} subject="Equipo" />,
    );
    expect(screen.getByText(emptyText[locale])).toBeInTheDocument();
    unmount();
    renderIn(
      locale,
      <TrendChart
        data={{
          ...trend,
          minGroupSize: 5,
          points: [
            {
              cycleId: "c1",
              cycleName: "H1 2024",
              periodStart: "2024-01-01",
              n: null,
              mean: null,
              counts: null,
              suppressed: true,
            },
          ],
        }}
        subject="Producto"
      />,
    );
    expect(
      screen.getByText(locale === "es" ? "menos de 5" : "fewer than 5"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: new RegExp(locale === "es" ? "no disponible" : "not available"),
      }),
    ).toBeInTheDocument();
  });
});

describe("filters and pickers", () => {
  it.each(locales)(
    "the filters form keeps the current choices (%s)",
    (locale) => {
      renderIn(
        locale,
        <IndicatorFiltersForm
          params={parseIndicatorParams({
            cycle: "c2",
            indicator: "engagement",
            groupBy: "manager",
            department: "Producto",
          })}
          cycles={[
            { id: "c2", name: "H2 2024" },
            { id: "c1", name: "H1 2024" },
          ]}
          options={{
            departments: ["Ingeniería", "Producto"],
            managers: [{ id: "m1", name: "Marta Quiroga" }],
            org: noOrgOptions,
          }}
        />,
      );
      const label = (es: string, en: string) => (locale === "es" ? es : en);
      expect(screen.getByLabelText(label("Ciclo", "Cycle"))).toHaveValue("c2");
      expect(
        screen.getByLabelText(label("Indicador", "Indicator")),
      ).toHaveValue("engagement");
      expect(
        screen.getByLabelText(label("Agrupar por", "Group by")),
      ).toHaveValue("manager");
      expect(screen.getByLabelText(label("Área", "Area"))).toHaveValue(
        "Producto",
      );
      expect(screen.getByLabelText("Manager")).toHaveValue("");
    },
  );

  it.each(locales)(
    "the trend picker offers people, teams and areas (%s)",
    (locale) => {
      renderIn(
        locale,
        <TrendPicker
          params={{ person: "p1" }}
          subjects={{
            departments: ["Ingeniería"],
            managers: [{ id: "m1", name: "Marta Quiroga" }],
            people: [{ id: "p1", name: "Fabio Luna" }],
          }}
        />,
      );
      expect(
        screen.getByLabelText(locale === "es" ? "Persona" : "Person"),
      ).toHaveValue("p1");
      expect(
        screen.getByLabelText(
          locale === "es" ? "Equipo (manager)" : "Team (manager)",
        ),
      ).toHaveValue("");
    },
  );

  it("a picker without people (direction) does not offer them", () => {
    renderIn(
      "es",
      <TrendPicker
        params={{}}
        subjects={{
          departments: ["Ingeniería"],
          managers: [{ id: "m1", name: "Marta Quiroga" }],
          people: [],
        }}
      />,
    );
    expect(screen.queryByLabelText("Persona")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Área")).toBeInTheDocument();
  });
});

describe("parseIndicatorParams / parseTrendParams", () => {
  it("falls back to retention by area as of the snapshot, and drops what is not an id", () => {
    expect(parseIndicatorParams({})).toEqual({
      cycle: undefined,
      indicator: "retention",
      groupBy: "department",
      hierarchy: "asOf",
      department: undefined,
      manager: undefined,
    });
    expect(
      parseIndicatorParams({
        indicator: "nope",
        groupBy: "none",
        hierarchy: "current",
        manager: "not-an-id",
      }),
    ).toMatchObject({
      indicator: "retention",
      groupBy: "none",
      hierarchy: "current",
      manager: undefined,
    });
    expect(
      parseTrendParams({
        person: "00000000-0000-4000-8000-000000000000",
        manager: "x",
        department: "Producto",
      }),
    ).toEqual({
      person: "00000000-0000-4000-8000-000000000000",
      manager: undefined,
      department: "Producto",
    });
  });
});

describe("org cuts in the indicator filters", () => {
  const options = {
    departments: ["Ingeniería"],
    managers: [],
    org: {
      accounts: ["Cuenta A"],
      projects: [],
      dms: ["Diego"],
      santexLeads: [],
    },
  };
  const form = (
    groupBys?: ComponentProps<typeof IndicatorFiltersForm>["groupBys"],
  ) => (
    <IndicatorFiltersForm
      params={parseIndicatorParams({
        cycle: "c1",
        groupBy: "account",
        dm: "Diego",
      })}
      cycles={[{ id: "c1", name: "H1 2024" }]}
      options={options}
      groupBys={groupBys}
    />
  );

  it("offers the cuts that have values, the grouping by them, and keeps what the URL says", () => {
    renderIn("es", form());

    expect(screen.getByLabelText("Cuenta")).toBeInTheDocument();
    expect(screen.getByLabelText("DM")).toHaveValue("Diego");
    expect(screen.queryByLabelText("Proyecto")).toBeNull();
    const groupBy = screen.getByLabelText("Agrupar por") as HTMLSelectElement;
    expect(groupBy).toHaveValue("account");
    expect([...groupBy.options].map((o) => o.text)).toEqual([
      "Área",
      "Manager",
      "Cuenta",
      "Proyecto",
      "DM",
      "Santex Lead",
      "Sin agrupar",
    ]);
  });

  it("direction is not offered the people", () => {
    renderIn(
      "en",
      form(["department", "manager", "account", "project", "none"]),
    );

    const groupBy = screen.getByLabelText("Group by") as HTMLSelectElement;
    expect([...groupBy.options].map((o) => o.text)).toEqual([
      "Area",
      "Manager",
      "Account",
      "Project",
      "No grouping",
    ]);
  });
});
