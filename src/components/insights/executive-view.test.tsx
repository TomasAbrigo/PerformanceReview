import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  bins,
  type ExecutiveSummary,
  type RatingDistribution,
} from "@/modules/analytics/dashboards/types";
import { ExecutiveView } from "./executive-view";
import { RatingHistogram } from "./rating-histogram";

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
      screen.getByRole("group", { name: /Ingeniería: 0–20 % 0, 20–40 % 1/ }),
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
    expect(screen.getByRole("group", { name: /^All:/ })).toBeInTheDocument();
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
