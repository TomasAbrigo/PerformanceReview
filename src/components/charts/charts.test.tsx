import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  BulletBar,
  GroupedBars,
  Histogram,
  Scatter,
  ChartFrame,
  DivergingLikert,
  LineTrend,
  Matrix,
  orderLikert,
  orderRows,
  Sparkline,
  StackedBar100,
  type StackRow,
  type StackSeries,
} from ".";

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
const nb = (s: string | null | undefined) => (s ?? "").replace(/\s/g, " ");

const series: StackSeries[] = [
  {
    key: "good",
    label: "Bueno",
    fill: "bg-chart-sent-positive",
    ink: "text-white",
  },
  {
    key: "bad",
    label: "Malo",
    fill: "bg-chart-sent-negative",
    ink: "text-white",
  },
];

describe("ChartFrame", () => {
  it("shows the question, how to read it, n/period, legend in order and a table toggle", () => {
    renderIn(
      "es",
      <ChartFrame
        id="c"
        title="¿Qué tan comprometidos están?"
        howToRead="Cada barra suma 100 %."
        meta="n = 12 · 2026"
        legend={series.map((s) => ({
          key: s.key,
          label: s.label,
          swatch: s.fill,
        }))}
        table={{ head: ["Grupo", "Bueno"], rows: [["A", 3]] }}
      >
        <svg />
      </ChartFrame>,
    );
    expect(
      screen.getByRole("heading", { name: "¿Qué tan comprometidos están?" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("chart-how")).toHaveTextContent(
      "Cada barra suma 100 %.",
    );
    expect(screen.getByTestId("chart-meta")).toHaveTextContent("n = 12 · 2026");
    const legend = within(screen.getByTestId("chart-legend")).getAllByRole(
      "listitem",
    );
    expect(legend.map((l) => l.textContent)).toEqual(["Bueno", "Malo"]);
    expect(screen.getByText("Ver como tabla")).toBeInTheDocument();
    const table = screen.getByRole("table", { hidden: true });
    expect(
      within(table).getByRole("rowheader", { hidden: true }),
    ).toHaveTextContent("A");
  });

  it("explains an empty or masked chart instead of drawing it", () => {
    renderIn(
      "es",
      <ChartFrame
        id="c"
        title="T"
        empty="Menos de 5 personas: oculto para Dirección."
      >
        <svg data-testid="never" />
      </ChartFrame>,
    );
    expect(screen.getByTestId("chart-empty")).toHaveTextContent(
      "Menos de 5 personas",
    );
    expect(screen.queryByTestId("never")).toBeNull();
  });

  it("shows a tooltip on keyboard focus of a mark", () => {
    renderIn(
      "en",
      <ChartFrame id="c" title="T">
        <span tabIndex={0} data-tip="A: 3 (75%)">
          x
        </span>
      </ChartFrame>,
    );
    fireEvent.focusIn(screen.getByText("x"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("A: 3 (75%)");
  });
});

describe("StackedBar100", () => {
  const rows: StackRow[] = [
    { key: "a", label: "Alfa", values: { good: 9, bad: 1 } },
    { key: "b", label: "Beta", values: { good: 1, bad: 3 } },
    { key: "c", label: "Gama", values: {}, masked: "Oculto" },
  ];
  it("orders rows by the share of the risk series, masked last", () => {
    expect(orderRows(rows, series, ["bad"]).map((r) => r.key)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(orderRows(rows, series).map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
  it("labels wide segments (not narrow ones) with es percents and keeps segment order = legend order", () => {
    renderIn(
      "es",
      <StackedBar100 rows={rows} series={series} sortBy={["bad"]} label="L" />,
    );
    const [beta, alfa, gama] = screen.getAllByTestId("stack-row");
    expect(beta).toHaveTextContent("Beta");
    expect(nb(alfa.textContent)).toContain("90 %");
    // A narrow segment (10 %) keeps its number for the tooltip and table only.
    expect(nb(alfa.textContent)).not.toContain("10 %");
    expect(alfa.querySelectorAll("[data-segment]")[0]).toHaveAttribute(
      "data-segment",
      "good",
    );
    expect(
      nb(alfa.querySelector("[data-segment='bad']")?.getAttribute("data-tip")),
    ).toBe("Alfa · Malo: 1 (10 %)");
    expect(gama).toHaveTextContent("Oculto");
  });
  it("formats percents in en without the space", () => {
    renderIn(
      "en",
      <StackedBar100 rows={rows.slice(0, 1)} series={series} label="L" />,
    );
    expect(screen.getByTestId("stack-row")).toHaveTextContent("90%");
  });
});

describe("DivergingLikert", () => {
  const rows = [
    { key: "x", label: "Equipo X", counts: [0, 1, 2, 3, 4] },
    { key: "y", label: "Equipo Y", counts: [4, 3, 2, 1, 0] },
    { key: "all", label: "Todos", counts: [4, 4, 4, 4, 4], strong: true },
  ];
  it("puts the total first, then the biggest low share", () => {
    expect(orderLikert(rows).map((r) => r.key)).toEqual(["all", "y", "x"]);
  });
  it("labels the low and high shares at both ends", () => {
    renderIn(
      "es",
      <DivergingLikert
        rows={rows}
        label="L"
        valueLabels={["1", "2", "3", "4", "5"]}
      />,
    );
    const y = screen.getAllByTestId("likert-row")[1];
    expect(nb(within(y).getByTestId("likert-low").textContent)).toBe("70 %");
    expect(nb(within(y).getByTestId("likert-high").textContent)).toBe("10 %");
    expect(y).toHaveTextContent("n = 10");
  });
});

describe("LineTrend", () => {
  it("leaves a gap for hidden points and labels the last value", () => {
    renderIn(
      "es",
      <LineTrend
        x={["e", "f", "m"]}
        series={[
          {
            key: "s",
            label: "Puntaje",
            values: [70, null, 72.4],
            color: "stroke-chart-seq fill-chart-seq",
          },
        ]}
        domain={[0, 100]}
        ticks={[0, 50, 100]}
        fmt={(v) => `${Math.round(v)} %`}
        label="L"
        yTitle="%"
        hiddenTip={(i) => (i === 1 ? "Oculto" : null)}
      />,
    );
    const d = screen.getByTestId("line-trend-path").getAttribute("d")!;
    expect(d.match(/M/g)).toHaveLength(2);
    expect(screen.getByTestId("line-trend-last")).toHaveTextContent("72 %");
    expect(screen.getByRole("img", { name: "Oculto" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(
      screen.getByRole("img", { name: "Puntaje · m: 72 %" }),
    ).toBeInTheDocument();
  });
});

describe("BulletBar", () => {
  it("writes the percent and the target in the label", () => {
    renderIn(
      "es",
      <BulletBar value={0.724} target={0.9} label="Autoevaluación" />,
    );
    expect(nb(screen.getByTestId("bullet-bar").textContent)).toBe("72 %");
    expect(nb(screen.getByRole("img").getAttribute("aria-label"))).toBe(
      "Autoevaluación: 72 % (meta 90 %)",
    );
  });
});

describe("Matrix", () => {
  it("names the axes and quadrants with counts, hidden cells as a dash", () => {
    const band = (k: string) => ({ key: k, name: k, range: "" });
    const cell = (k: string, count: number | null) => ({
      key: k,
      count,
      name: `Q${k}`,
      tip: `tip ${k}`,
    });
    renderIn(
      "es",
      <Matrix
        rows={[band("hi"), band("mid"), band("lo")]}
        cols={[band("lo"), band("mid"), band("hi")]}
        cells={[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) =>
            cell(`${r}${c}`, r === 2 && c === 0 ? null : r + c),
          ),
        )}
        xTitle="Retención"
        yTitle="Compromiso"
        label="M"
      />,
    );
    expect(screen.getByText("Retención →")).toBeInTheDocument();
    expect(screen.getByText("↑ Compromiso")).toBeInTheDocument();
    const cells = screen.getAllByTestId("matrix-cell");
    expect(cells).toHaveLength(9);
    expect(cells[6]).toHaveTextContent("Q20–");
  });
});

describe("Sparkline", () => {
  it("marks min, max and last and writes the last value", () => {
    const { container } = renderIn(
      "es",
      <Sparkline
        series={[
          {
            key: "s",
            values: [3, 1, 5, 4],
            color: "stroke-chart-seq fill-chart-seq",
          },
        ]}
        domain={[1, 5]}
        fmt={(v) => v.toFixed(1)}
        label="S"
      />,
    );
    for (const m of ["min", "max", "last"])
      expect(container.querySelector(`[data-mark='${m}']`)).not.toBeNull();
    expect(container).toHaveTextContent("4.0");
  });
});

describe("Histogram", () => {
  it("writes count and share on each bar, bars focusable", () => {
    renderIn(
      "es",
      <Histogram
        max={3}
        label="H"
        bins={[
          { key: "a", tick: "0–50 %", count: 1, tip: "A: 1" },
          { key: "b", tick: "50–100 %", count: 3, tip: "B: 3" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "B: 3" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(nb(screen.getByRole("group").textContent)).toContain("75 %");
    expect(screen.getByText("50–100 %")).toBeInTheDocument();
  });
});

describe("GroupedBars", () => {
  it("labels each bar with its value and explains masked groups", () => {
    renderIn(
      "en",
      <GroupedBars
        label="G"
        yTitle="Mean (1–5)"
        domain={[0, 5]}
        ticks={[1, 5]}
        fmt={(v) => v.toFixed(1)}
        series={[{ key: "r", label: "Retention", fill: "bg-chart-seq" }]}
        groups={[
          { key: "a", label: "0–20%", sub: "n = 4", values: { r: 3.5 } },
          { key: "b", label: "20–40%", values: { r: null }, masked: "Hidden" },
        ]}
      />,
    );
    expect(
      screen.getByRole("img", { name: "0–20% · Retention: 3.5" }),
    ).toBeInTheDocument();
    expect(screen.getByText("n = 4")).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });
});

describe("Scatter clusters (#133)", () => {
  it("writes how many people share a position from 5 on", () => {
    const at = (n: number, x: number) =>
      Array.from({ length: n }, (_, i) => ({
        key: `${x}-${i}`,
        x,
        y: 3,
        tip: "t",
      }));
    renderIn(
      "es",
      <Scatter
        points={[...at(6, 0), ...at(2, 50)]}
        xDomain={[0, 100]}
        yDomain={[1, 5]}
        xTicks={[0, 100]}
        yTicks={[1, 5]}
        xFmt={String}
        yFmt={String}
        xTitle="x"
        yTitle="y"
        label="L"
      />,
    );
    const labels = screen.getAllByTestId("scatter-cluster");
    expect(labels.map((l) => l.textContent)).toEqual(["×6"]);
  });
});

describe("Scatter", () => {
  it("has titled axes, reference lines and a focusable point per person (duplicates spread)", () => {
    const { container } = renderIn(
      "es",
      <Scatter
        label="S"
        points={[
          { key: "1", x: 50, y: 3, tip: "Ana" },
          { key: "2", x: 50, y: 3, tip: "Beto" },
        ]}
        xDomain={[0, 100]}
        yDomain={[1, 5]}
        xTicks={[0, 100]}
        yTicks={[1, 5]}
        xFmt={(v) => `${v} %`}
        yFmt={String}
        xTitle="Objetivos"
        yTitle="Retención"
        refs={[{ axis: "y", value: 2.5, label: "Riesgo" }]}
      />,
    );
    expect(screen.getByText("Objetivos →")).toBeInTheDocument();
    expect(screen.getByText("↑ Retención")).toBeInTheDocument();
    expect(screen.getByTestId("scatter-ref")).toHaveTextContent("Riesgo");
    const [a, b] = screen.getAllByRole("img");
    expect(a).toHaveAttribute("tabindex", "0");
    const cx = (g: Element) =>
      g.querySelectorAll("circle")[1].getAttribute("cx");
    expect(cx(a)).not.toBe(cx(b));
    expect(container.querySelectorAll("svg title")).toHaveLength(2);
  });
});
