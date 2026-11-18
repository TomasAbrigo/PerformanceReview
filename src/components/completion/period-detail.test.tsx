import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type {
  PeriodDetail,
  PeriodDetailRow,
} from "@/modules/analytics/period-detail/types";
import { PeriodDetailTable } from "./period-detail-table";

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

const row = (over: Partial<PeriodDetailRow> = {}): PeriodDetailRow => ({
  cycleId: "c1",
  cycleName: "H1 2024",
  localizedName: null,
  periodStart: "2024-01-01",
  periodEnd: "2024-06-30",
  participants: 40,
  selfRate: 0.85,
  managerRate: 0.9,
  valued: { n: 30, mean: 3.2 },
  retention: { n: 38, mean: 3.75 },
  engagement: { n: 38, mean: 3.9 },
  goalsCompletedPct: 0,
  goals: 120,
  ...over,
});
const data = (
  rows: PeriodDetailRow[],
  min: number | null = null,
): PeriodDetail => ({
  rows,
  minGroupSize: min,
});
describe("PeriodDetailTable", () => {
  it.each(["es", "en"] as const)(
    "shows each period with completion meters, localized means and sample counts (%s)",
    (locale) => {
      renderIn(
        locale,
        <PeriodDetailTable
          data={data([
            row(),
            row({ cycleId: "c2", cycleName: "H2 2024", participants: 42 }),
          ])}
        />,
      );
      const cards = screen.getAllByRole("article");
      expect(cards).toHaveLength(2);
      expect(cards[0]).toHaveAccessibleName("H1 2024");
      expect(
        within(cards[0])
          .getAllByRole("progressbar")
          .map((x) => x.getAttribute("aria-valuenow")),
      ).toEqual(["85", "90", "0"]);
      expect(cards[0]).toHaveTextContent(locale === "es" ? "3,20" : "3.20");
      expect(cards[0]).toHaveTextContent(locale === "es" ? "3,75" : "3.75");
      expect(cards[0]).toHaveTextContent(locale === "es" ? "3,90" : "3.90");
      expect(cards[0]).toHaveTextContent("30");
      expect(cards[0]).toHaveTextContent("38");
      expect(cards[0]).toHaveTextContent("120");
      expect(cards[1]).toHaveTextContent("42");
    },
  );
  it("distinguishes missing measurements from zero", () => {
    renderIn(
      "es",
      <PeriodDetailTable
        data={data([
          row({
            selfRate: null,
            valued: null,
            retention: null,
            goalsCompletedPct: null,
            goals: 0,
          }),
        ])}
      />,
    );
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "90",
    );
    expect(screen.getByRole("article")).not.toHaveTextContent("de 0");
  });
  it("keeps suppressed values hidden for direction", () => {
    renderIn(
      "es",
      <PeriodDetailTable
        data={data(
          [
            row({
              participants: 3,
              selfRate: null,
              managerRate: null,
              valued: null,
              retention: null,
              engagement: null,
              goalsCompletedPct: null,
              goals: null,
            }),
          ],
          5,
        )}
      />,
    );
    expect(screen.getAllByText("Oculto")).toHaveLength(6);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveTextContent("3");
  });
  it("says there are no cycles", () => {
    renderIn("es", <PeriodDetailTable data={data([])} />);
    expect(screen.getByText("Todavía no hay ciclos lanzados.")).toBeVisible();
  });
});
