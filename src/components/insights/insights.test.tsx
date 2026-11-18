import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type {
  CompletionGroup,
  CompletionSummary,
} from "@/modules/analytics/completion";
import type {
  ExecutiveMode,
  ExecutiveReport,
} from "@/modules/insights/executive";
import type { SelfAssessmentReport } from "@/modules/insights/self-assessment";
import { CompletionTable } from "./completion-table";
import { ExecutiveReportView, ModeToggle } from "./executive-report-view";
import { HealthCheckView } from "./health-check-view";
import { SelfAssessmentView } from "./self-assessment-view";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: ComponentProps<"a">) => (
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
const counts = {
  positive: 3,
  constructive: 1,
  neutral: 0,
  mixed: 0,
  negative: 1,
  total: 5,
};

const group = (
  key: string | null,
  participants: number,
  self: [number, number],
  manager: [number, number],
): CompletionGroup => ({
  key,
  label: key,
  participants,
  selfSubmitted: self[0],
  selfApplicable: self[1],
  managerSubmitted: manager[0],
  managerApplicable: manager[1],
  selfRate: self[1] ? self[0] / self[1] : null,
  managerRate: manager[1] ? manager[0] / manager[1] : null,
});
const completion: CompletionSummary = {
  cycleId: "c1",
  cycleName: "H2",
  groupBy: "department",
  hierarchy: "asOf",
  participants: 9,
  groups: [group("Ingeniería", 6, [3, 6], [6, 6])],
  others: null,
  total: group(null, 9, [3, 9], [9, 9]),
  suppressed: 3,
  minGroupSize: 5,
  sources: { progress: 0, requests: 9 },
};

const dims = (locale: "es" | "en") => ({
  strengths: locale === "es" ? "Fortalezas" : "Strengths",
});

describe("SelfAssessmentView", () => {
  const report: SelfAssessmentReport = {
    minGroupSize: null,
    completion: { ...completion, minGroupSize: null, suppressed: 0 },
    sentiment: [{ dimension: "strengths", ...counts }],
    themes: [{ theme: "calidad", count: 2, sentiment: counts, quotes: [] }],
    gap: [
      {
        questionRevisionId: "q",
        prompt: { es: "Retención", en: "Retention" },
        n: 2,
        meanSelf: 0.625,
        meanManager: 0.25,
        meanGap: -0.375,
      },
    ],
    sentimentGap: [
      {
        dimension: "strengths",
        self: counts,
        manager: {
          positive: 1,
          constructive: 1,
          neutral: 0,
          mixed: 0,
          negative: 0,
          total: 2,
        },
      },
    ],
  };

  it.each(locales)(
    "renders completion, sentiment, themes and gap (%s)",
    (locale) => {
      renderIn(
        locale,
        <SelfAssessmentView report={report} dimensionLabel={dims(locale)} />,
      );
      const table = screen.getByRole("table", {
        name: locale === "es" ? "Completitud por grupo" : "Completion by group",
      });
      expect(within(table).getByText("Ingeniería")).toBeVisible();
      expect(
        within(table).getAllByText(locale === "es" ? "50 %" : "50%"),
      ).toHaveLength(1);
      expect(
        screen.getByRole("img", {
          name:
            locale === "es"
              ? "Sentimiento de las autoevaluaciones por dimensión"
              : "Sentiment of the self assessments by dimension",
        }),
      ).toBeVisible();
      expect(screen.getByText("calidad")).toBeVisible();
      const gap = screen.getByRole("table", {
        name: locale === "es" ? "Brecha por pregunta" : "Gap by question",
      });
      expect(
        within(gap).getByText(locale === "es" ? "Retención" : "Retention"),
      ).toBeVisible();
      expect(within(gap).getByText("-0.38")).toBeVisible();
      // The bar's label (and its row in the table twin of the chart).
      expect(
        screen.getAllByText(
          locale === "es" ? "Fortalezas · autoevaluación" : "Strengths · self",
        ).length,
      ).toBeGreaterThan(0);
    },
  );

  it("direction: says what is masked and how many are left out", () => {
    renderIn(
      "es",
      <SelfAssessmentView
        report={{
          ...report,
          minGroupSize: 5,
          completion,
          sentiment: [],
          themes: [],
          gap: [],
          sentimentGap: [],
        }}
        dimensionLabel={dims("es")}
      />,
    );
    expect(screen.getByText(/grupos de menos de 5 personas/)).toBeVisible();
    expect(
      screen.getByText("3 personas en grupos chicos (no se desglosan)"),
    ).toBeVisible();
    expect(
      screen.getAllByText("Sin datos para mostrar.").length,
    ).toBeGreaterThan(0);
  });
});

describe("HealthCheckView", () => {
  it.each(locales)(
    "shows the landed counts and the open questions (%s)",
    (locale) => {
      renderIn(
        locale,
        <HealthCheckView
          data={{
            runs: 3,
            files: 2,
            rows: 5,
            lastLandedAt: new Date("2026-05-02T10:00:00Z"),
          }}
        />,
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        locale === "es"
          ? "Formato pendiente de definir"
          : "Format to be defined",
      );
      expect(screen.getByTestId("health-check-files")).toHaveTextContent("2");
      expect(screen.getByTestId("health-check-runs")).toHaveTextContent("3");
      expect(screen.getByTestId("health-check-rows")).toHaveTextContent("5");
      const questions = screen.getByRole("list", {
        name: locale === "es" ? "Preguntas abiertas" : "Open questions",
      });
      expect(within(questions).getAllByRole("listitem")).toHaveLength(4);
    },
  );

  it("nothing landed yet", () => {
    renderIn(
      "es",
      <HealthCheckView
        data={{ runs: 0, files: 0, rows: 0, lastLandedAt: null }}
      />,
    );
    expect(screen.getByText("Nunca")).toBeVisible();
  });
});

describe("ExecutiveReportView", () => {
  const full: ExecutiveReport = {
    cycleId: "c1",
    mode: "both",
    minGroupSize: null,
    completion: { ...completion, minGroupSize: null },
    retention: { n: 9, mean: 28 / 9, counts: [1, 3, 1, 2, 2] },
    engagement: { n: 8, mean: 2.875, counts: [1, 3, 1, 2, 1] },
    risk: { riskCount: 3, total: 8 },
    goals: {
      key: null,
      label: null,
      others: false,
      people: 9,
      peopleWithGoals: 6,
      goals: 20,
      completed: 10,
      inProgress: 8,
      closed: 2,
      overdue: 3,
      completedPct: 50,
      inProgressPct: 40,
      overduePct: 15,
      avgProgress: 60,
    },
    sentiment: [{ dimension: "strengths", ...counts }],
    themes: [
      { theme: "calidad", count: 2, sentiment: counts, quotes: [] },
      { theme: "colaboracion", count: 2, sentiment: counts, quotes: [] },
    ],
  };
  const forMode = (mode: ExecutiveMode): ExecutiveReport => {
    const { retention, engagement, risk, goals, sentiment, themes, ...rest } =
      full;
    return {
      ...rest,
      mode,
      ...(mode !== "qualitative" ? { retention, engagement, risk, goals } : {}),
      ...(mode !== "quantitative" ? { sentiment, themes } : {}),
    };
  };

  for (const locale of locales) {
    for (const mode of ["qualitative", "quantitative", "both"] as const) {
      it(`${mode} mode shows its blocks (${locale})`, () => {
        renderIn(
          locale,
          <>
            <ModeToggle mode={mode} cycleId="c1" />
            <ExecutiveReportView
              report={forMode(mode)}
              dimensionLabel={dims(locale)}
            />
          </>,
        );
        expect(screen.getByTestId("exec-self-pct")).toHaveTextContent(
          locale === "es" ? "33 %" : "33%",
        );
        expect(screen.getByTestId("exec-manager-pct")).toHaveTextContent("100");
        const quant = mode !== "qualitative";
        const qual = mode !== "quantitative";
        expect(screen.queryByTestId("exec-retention") !== null).toBe(quant);
        expect(screen.queryByTestId("exec-engagement") !== null).toBe(quant);
        expect(screen.queryByTestId("exec-risk") !== null).toBe(quant);
        expect(screen.queryByTestId("exec-goals") !== null).toBe(quant);
        expect(screen.queryByTestId("exec-sentiment") !== null).toBe(qual);
        expect(screen.queryByTestId("exec-themes") !== null).toBe(qual);
        if (quant) {
          expect(screen.getByTestId("exec-retention")).toHaveTextContent(
            "3.11",
          );
          expect(screen.getByTestId("exec-risk")).toHaveTextContent("3");
          expect(screen.getByTestId("exec-goals")).toHaveTextContent(
            locale === "es" ? "50 %" : "50%",
          );
        }
        if (qual) {
          expect(screen.getByText("colaboracion")).toBeVisible();
        }
        const toggle = screen.getByRole("navigation", {
          name: locale === "es" ? "Modo" : "Mode",
        });
        const current = within(toggle).getByRole("link", {
          name: {
            es: {
              qualitative: "Cualitativo",
              quantitative: "Cuantitativo",
              both: "Ambos",
            },
            en: {
              qualitative: "Qualitative",
              quantitative: "Quantitative",
              both: "Both",
            },
          }[locale][mode],
        });
        expect(current).toHaveAttribute("aria-current", "true");
        expect(current).toHaveAttribute(
          "href",
          `/insights/executive?cycle=c1&mode=${mode}`,
        );
      });
    }
  }

  it("direction: masked tiles say they are hidden", () => {
    renderIn(
      "es",
      <ExecutiveReportView
        report={{
          ...full,
          minGroupSize: 5,
          retention: null,
          risk: { riskCount: null, total: null },
          sentiment: [],
          themes: [],
        }}
        dimensionLabel={dims("es")}
      />,
    );
    expect(screen.getByTestId("exec-retention")).toHaveTextContent(
      "Oculto: menos de 5 personas.",
    );
    expect(screen.getByTestId("exec-risk")).toHaveTextContent("Oculto");
    expect(screen.getByText(/grupos de menos de 5 personas/)).toBeVisible();
  });
});

describe("unavailable data and suppressed groups", () => {
  it("People with no indicator data see the empty text, not 'Oculto'", () => {
    renderIn(
      "es",
      <ExecutiveReportView
        report={{
          cycleId: "c1",
          mode: "quantitative",
          minGroupSize: null,
          completion: { ...completion, total: null, minGroupSize: null },
          retention: null,
          engagement: null,
          risk: { riskCount: null, total: null },
        }}
        dimensionLabel={{}}
      />,
    );
    expect(screen.getByTestId("exec-retention")).toHaveTextContent(
      "Sin datos para mostrar.",
    );
    expect(screen.queryByText(/Oculto/)).toBeNull();
  });

  it("all groups suppressed: says how many people are left out", () => {
    renderIn(
      "es",
      <CompletionTable
        data={{ ...completion, groups: [], total: null, suppressed: 4 }}
      />,
    );
    expect(
      screen.getByText("4 personas en grupos chicos (no se desglosan)"),
    ).toBeVisible();
    expect(screen.queryByText("Sin datos para mostrar.")).toBeNull();
  });

  it("direction's teams have a key but no name: numbered, never 'Sin manager'", () => {
    const team = (key: string) => ({
      ...group(key, 6, [3, 6], [6, 6]),
      label: null,
    });
    renderIn(
      "es",
      <CompletionTable
        data={{
          ...completion,
          groupBy: "manager",
          groups: [team("m-1"), team("m-2")],
          total: null,
        }}
        groupBy="manager"
      />,
    );
    expect(screen.getByText("Equipo 1")).toBeVisible();
    expect(screen.getByText("Equipo 2")).toBeVisible();
    expect(screen.queryByText("Sin manager")).toBeNull();
  });

  it("names the group without a key per grouping", () => {
    const g = group(null, 2, [1, 2], [2, 2]);
    const data = {
      ...completion,
      groups: [g],
      total: null,
      minGroupSize: null,
    };
    const { unmount } = renderIn(
      "es",
      <CompletionTable data={data} groupBy="manager" />,
    );
    expect(screen.getByText("Sin manager")).toBeVisible();
    unmount();
    renderIn("en", <CompletionTable data={data} />);
    expect(screen.getByText("No department")).toBeVisible();
  });
});

describe("the mode toggle keeps the org cuts", () => {
  it("every mode's link carries the cuts of the page", () => {
    renderIn(
      "es",
      <ModeToggle
        mode="both"
        cycleId="c1"
        filters={{ account: "Cuenta A", dm: undefined, santexLead: "Lía" }}
      />,
    );

    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toHaveLength(3);
    for (const href of hrefs) {
      expect(href).toContain("account=Cuenta+A");
      expect(href).toContain("santexLead=L%C3%ADa");
      expect(href).not.toContain("dm=");
    }
    expect(hrefs[0]).toContain("mode=");
  });
});
