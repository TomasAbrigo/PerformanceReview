import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type {
  EngagementEvolution,
  EngagementFilterOptions,
  EngagementMonth,
} from "@/modules/analytics/engagement/types";
import { noOrgOptions } from "@/modules/org-attributes/kinds";
import { EngagementView } from "./engagement-view";
import { EngagementFiltersForm } from "./filters";
import { monthStart, parseEngagementParams } from "./params";

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

const month = (
  m: string,
  over: Partial<EngagementMonth> = {},
): EngagementMonth => ({
  month: m,
  hidden: false,
  people: 10,
  respondents: 8,
  participation: 0.8,
  mean: 0.62,
  segments: { alto: 2, medio: 3, regular: 2, bajo: 1, falta: 2 },
  ...over,
});

const data = (months: EngagementMonth[], min: number | null = null) =>
  ({
    months,
    from: months[0]?.month ?? null,
    to: months.at(-1)?.month ?? null,
    minGroupSize: min,
    hiddenMonths: months.filter((m) => m.hidden).length,
  }) satisfies EngagementEvolution;

describe("EngagementView", () => {
  it.each(locales)(
    "draws the score and participation lines and the segment bars, with a table of every number (%s)",
    (locale) => {
      renderIn(
        locale,
        <EngagementView
          data={data([
            month("2026-01-01"),
            month("2026-02-01", { mean: 0.7, participation: 0.9 }),
          ])}
        />,
      );

      const line = screen.getByRole("group", {
        name:
          locale === "es"
            ? /Score promedio y participación por mes/
            : /Mean score and participation per month/,
      });
      expect(line).toBeVisible();
      expect(line.querySelector('[data-series="score"]')).not.toBeNull();
      expect(
        line.querySelector('[data-series="participation"]'),
      ).not.toBeNull();
      const bars = screen.getByRole("group", {
        name:
          locale === "es"
            ? /Personas por segmento y por mes/
            : /People per segment and per month/,
      });
      // Five segments per month, in order (= legend order), none empty.
      const jan = within(bars).getAllByTestId("segment-row")[0];
      expect(
        [...jan.querySelectorAll("[data-segment]")].map((e) =>
          e.getAttribute("data-segment"),
        ),
      ).toEqual(["alto", "medio", "regular", "bajo", "falta"]);
      const table = screen.getByRole("table", {
        name: locale === "es" ? "Detalle por mes" : "Detail by month",
      });
      const rows = within(table).getAllByRole("row");
      expect(rows).toHaveLength(3);
      const janCells = within(rows[1])
        .getAllByRole("cell")
        .map((c) => c.textContent?.replace(/\s/g, " "));
      expect(janCells.slice(1)).toEqual([
        "10",
        "8",
        locale === "es" ? "80 %" : "80%",
        locale === "es" ? "0,62" : "0.62",
        "2",
        "3",
        "2",
        "1",
        "2",
      ]);
    },
  );

  it("leaves a gap and a message for a month direction cannot see", () => {
    renderIn(
      "es",
      <EngagementView
        data={data(
          [
            month("2026-01-01"),
            month("2026-02-01", {
              hidden: true,
              people: null,
              respondents: null,
              participation: null,
              mean: null,
              segments: null,
            }),
            month("2026-03-01"),
          ],
          5,
        )}
      />,
    );

    const table = screen.getByRole("table", { name: "Detalle por mes" });
    expect(
      within(table).getByText("Menos de 5 personas: no se muestra."),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 mes sin mostrar por tener menos de 5 personas.",
    );
    const line = screen.getByRole("group", {
      name: /Score promedio y participación por mes/,
    });
    // Two strokes per series: the hidden month is a gap, not a bridge.
    const path = line.querySelector('[data-series="score"] path')!;
    expect(path.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(
      screen.getByRole("img", { name: /mes oculto por tamaño de grupo/ }),
    ).toBeVisible();
    expect(
      screen.getByText("Menos de 5 personas: oculto para Dirección."),
    ).toBeVisible();
  });

  it("shows 'Oculto' where a cell was masked but the month is visible", () => {
    renderIn(
      "es",
      <EngagementView
        data={data(
          [
            month("2026-01-01", {
              segments: null,
              participation: null,
              respondents: null,
            }),
          ],
          5,
        )}
      />,
    );
    const row = within(
      screen.getByRole("table", { name: "Detalle por mes" }),
    ).getAllByRole("row")[1];
    expect(within(row).getAllByText("Oculto").length).toBeGreaterThanOrEqual(7);
    expect(
      screen.getByText(
        "Segmentos con menos de 5 personas: ocultos para Dirección.",
      ),
    ).toBeVisible();
  });

  it("says there is nothing to show without months", () => {
    renderIn("es", <EngagementView data={data([])} />);
    expect(screen.getByText("No hay datos para estos filtros.")).toBeVisible();
  });
});

describe("EngagementFiltersForm", () => {
  const options: EngagementFilterOptions = {
    org: { ...noOrgOptions, accounts: ["Cuenta A", "Cuenta B"] },
    departments: ["Datos", "Ingeniería"],
    firstMonth: "2025-05-01",
    lastMonth: "2026-04-01",
  };

  it("is a GET form with the range, the area and the org cuts", () => {
    renderIn(
      "es",
      <EngagementFiltersForm
        params={{ account: "Cuenta B" }}
        options={options}
        range={{ from: "2025-05-01", to: "2026-04-01" }}
      />,
    );
    const form = screen.getByRole("form", {
      name: "Filtros de engagement mensual",
    });
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByLabelText("Desde")).toHaveValue("2025-05");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-04");
    expect(screen.getByLabelText("Área")).toHaveValue("");
    expect(screen.getByLabelText("Cuenta")).toHaveValue("Cuenta B");
  });
});

describe("parseEngagementParams", () => {
  it("reads months as YYYY-MM and drops what is not a month", () => {
    expect(
      parseEngagementParams({
        from: "2026-01",
        to: "marzo",
        department: "Datos",
        account: " Cuenta A ",
      }),
    ).toEqual({
      from: "2026-01",
      to: undefined,
      department: "Datos",
      account: "Cuenta A",
      project: undefined,
      dm: undefined,
      santexLead: undefined,
    });
    expect(parseEngagementParams({ from: "03/2026" }).from).toBe("2026-03");
  });

  it("makes the first day of a month param", () => {
    expect(monthStart("2026-03")).toBe("2026-03-01");
    expect(monthStart(undefined)).toBeUndefined();
  });
});
