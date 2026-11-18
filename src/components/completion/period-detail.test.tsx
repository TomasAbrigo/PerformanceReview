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
const norm = (s: string | null) => s?.replace(/\s/g, " ");

describe("PeriodDetailTable", () => {
  it("shows N, completion, the three means with their people, and goals completed per cycle (es)", () => {
    renderIn(
      "es",
      <PeriodDetailTable
        data={data([
          row(),
          row({ cycleId: "c2", cycleName: "H2 2024", participants: 42 }),
        ])}
      />,
    );

    const table = screen.getByRole("table", { name: "Detalle por período" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0])
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual([
      "Ciclo",
      "Personas",
      "Autoevaluación",
      "Evaluación del manager",
      "Valoración propia (1-4)",
      "Retención (1-5)",
      "Compromiso Bamboo (1-5)",
      "Goals completados",
    ]);
    const first = within(rows[1]);
    expect(first.getByRole("rowheader")).toHaveTextContent("H1 2024");
    const cells = first.getAllByRole("cell").map((c) => norm(c.textContent));
    expect(cells).toEqual([
      "40",
      "85 %",
      "90 %",
      "3,20 (30 personas)",
      "3,75 (38 personas)",
      "3,90 (38 personas)",
      "0 % de 120",
    ]);
    expect(within(rows[2]).getAllByRole("cell")[0]).toHaveTextContent("42");
  });

  it("reads in English", () => {
    renderIn("en", <PeriodDetailTable data={data([row()])} />);
    const table = screen.getByRole("table", { name: "Detail by period" });
    expect(norm(within(table).getAllByRole("cell")[3].textContent)).toBe(
      "3.20 (30 people)",
    );
    expect(norm(within(table).getAllByRole("cell")[1].textContent)).toBe("85%");
  });

  it("People see a dash where there is nothing to average, and no goals total without goals", () => {
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
    const cells = within(screen.getByTestId("period-detail"))
      .getAllByRole("row")[1]
      .querySelectorAll("td");
    expect([...cells].map((c) => c.textContent)).toEqual([
      "40",
      "—",
      expect.stringContaining("90"),
      "—",
      "—",
      expect.stringContaining("3,90"),
      "—",
    ]);
  });

  it("direction sees 'Oculto' instead of a figure under the minimum, and the head count stays", () => {
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
    const row1 = within(screen.getByTestId("period-detail")).getAllByRole(
      "row",
    )[1];
    const cells = [...row1.querySelectorAll("td")].map((c) => c.textContent);
    expect(cells[0]).toBe("3");
    expect(cells.slice(1)).toEqual(Array(6).fill("Oculto"));
  });

  it("says there are no cycles", () => {
    renderIn("es", <PeriodDetailTable data={data([])} />);
    expect(screen.getByText("Todavía no hay ciclos lanzados.")).toBeVisible();
  });
});
