import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { Dm360, Dm360Card } from "@/modules/analytics/dm-360/types";
import { Dm360View } from "./dm-360-view";
import { parseDm360Params } from "./params";
import { Sparkline } from "./sparkline";

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

const trend = [
  {
    cycleId: "c1",
    cycleName: "H1 2024",
    periodStart: "2024-01-01",
    people: 4,
    retention: 4,
    engagement: 3.5,
  },
  {
    cycleId: "c2",
    cycleName: "H2 2024",
    periodStart: "2024-07-01",
    people: 5,
    retention: null,
    engagement: null,
  },
  {
    cycleId: "c3",
    cycleName: "H1 2025",
    periodStart: "2025-01-01",
    people: 5,
    retention: 2,
    engagement: 3,
  },
];

const card = (over: Partial<Dm360Card> = {}): Dm360Card => ({
  key: "Diego",
  label: "Diego",
  others: false,
  people: 5,
  retention: { mean: 2, n: 5 },
  engagement: { mean: 3, n: 5 },
  risk: { people: 2, of: 5, share: 0.4 },
  signals: { people: 2, of: 4, share: 0.5 },
  selfRate: 1,
  managerRate: 0.6,
  trend,
  insights: [
    {
      code: "retentionDrop",
      params: { previous: 4, current: 2, delta: 2, cycle: "H1 2024" },
    },
    { code: "signals", params: { percent: 50, people: 2, of: 4 } },
  ],
  ...over,
});

const data = (over: Partial<Dm360> = {}): Dm360 => ({
  cycleId: "c3",
  cycleName: "H1 2025",
  scope: "direct",
  minGroupSize: null,
  thresholds: { dropThreshold: 2, riskThreshold: 2, goodPct: 80, watchPct: 50 },
  cards: [card()],
  withoutDm: 0,
  suppressed: 0,
  ...over,
});

describe("parseDm360Params", () => {
  it("reads the cycle and the scope, direct by default", () => {
    expect(parseDm360Params({ cycle: "c1", scope: "tree" })).toEqual({
      cycle: "c1",
      scope: "tree",
    });
    expect(parseDm360Params({ scope: "everything" })).toEqual({
      cycle: undefined,
      scope: "direct",
    });
  });
});

describe("Dm360View", () => {
  it("a card per DM: people, means, risk, sentiment, completion and the lines the rules wrote (es)", () => {
    renderIn("es", <Dm360View data={data()} />);

    const c = screen.getByTestId("dm-card");
    expect(
      within(c).getByRole("heading", { name: "Diego" }),
    ).toBeInTheDocument();
    expect(within(c).getByTestId("dm-card-people")).toHaveTextContent(
      "5 personas",
    );
    expect(within(c).getByTestId("dm-retention")).toHaveTextContent("2,0");
    expect(within(c).getByTestId("dm-engagement")).toHaveTextContent("3,0");
    expect(within(c).getByTestId("dm-risk")).toHaveTextContent("40 % (2 de 5)");
    expect(within(c).getByTestId("dm-self")).toHaveTextContent("100 %");
    expect(within(c).getByTestId("dm-manager")).toHaveTextContent("60 %");
    expect(within(c).getByTestId("dm-signals")).toHaveTextContent(
      "2 de 4 personas con comentarios leídos",
    );
    const lines = within(c).getByTestId("dm-insights").querySelectorAll("li");
    expect([...lines].map((l) => l.textContent)).toEqual([
      "La retención media cayó 2 puntos desde H1 2024, el ciclo anterior (de 4 a 2).",
      "El 50 % de las personas con comentarios leídos (2 de 4) tiene alguna señal a atender.",
    ]);
  });

  it("#133: means say over how many people, ISO-day cycles read as months, a mean short of target is not 'no alerts'", () => {
    renderIn(
      "es",
      <Dm360View
        data={data({
          cards: [
            card({
              insights: [
                {
                  code: "retentionDrop",
                  params: {
                    previous: 4,
                    current: 2,
                    delta: 2,
                    cycle: "Evaluación semestral 2025-03-29 – 2025-09-28",
                  },
                },
              ],
            }),
            card({
              key: "Dora",
              label: "Dora",
              insights: [
                {
                  code: "belowTarget",
                  params: { retention: 1, engagement: 1 },
                },
              ],
            }),
          ],
        })}
      />,
    );
    const [diego, dora] = screen.getAllByTestId("dm-card");
    expect(within(diego).getByTestId("dm-retention")).toHaveTextContent(
      "promedio de 5 personas",
    );
    expect(within(diego).getByTestId("dm-insights")).toHaveTextContent(
      "desde Evaluación semestral mar – sept 2025",
    );
    const pill = within(dora).getByTestId("dm-insights");
    expect(pill).toHaveTextContent(
      "Sin alertas; por debajo de la meta: Retención media, Compromiso medio.",
    );
    expect(pill.querySelector("li")).toHaveAttribute("data-tone", "watch");
  });

  it("with a base (direct scope, names): each figure opens the DM's people or comments", () => {
    renderIn(
      "es",
      <Dm360View
        data={data()}
        base={{ pathname: "/insights/360", query: {} }}
        thresholds={{ goodPct: 80, watchPct: 60 }}
      />,
    );
    const c = screen.getByTestId("dm-card");
    const drills = within(c)
      .getAllByRole("link")
      .map((a) => a.getAttribute("data-drill"));
    expect(drills).toEqual(
      expect.arrayContaining([
        "dm:retention:Diego",
        "dm:risk:Diego",
        "dm:manager:Diego",
        "dm:comments:Diego",
      ]),
    );
    // Self assessments are all in: nothing pending to open.
    expect(drills).not.toContain("dm:self:Diego");
    expect(within(c).getAllByRole("meter").length).toBeGreaterThanOrEqual(5);
  });

  it("the same in English", () => {
    renderIn("en", <Dm360View data={data()} />);

    const c = screen.getByTestId("dm-card");
    expect(within(c).getByTestId("dm-retention")).toHaveTextContent("2.0");
    expect(within(c).getByTestId("dm-risk")).toHaveTextContent("40% (2 of 5)");
    expect(within(c).getByTestId("dm-insights")).toHaveTextContent(
      "Mean retention fell 2 points since H1 2024, the previous cycle (from 4 to 2).",
    );
  });

  it("direction's cards are numbered teams and Otros, never a name; hidden figures are a dash", () => {
    renderIn(
      "es",
      <Dm360View
        data={data({
          minGroupSize: 5,
          withoutDm: null,
          suppressed: 3,
          cards: [
            card({
              key: "g1",
              label: null,
              retention: null,
              engagement: null,
              risk: null,
              signals: null,
              selfRate: null,
              managerRate: null,
              insights: [{ code: "noData" }],
            }),
            card({ key: "g2", label: null }),
            card({ key: "others", label: null, others: true }),
          ],
        })}
      />,
    );

    const cards = screen.getAllByTestId("dm-card");
    expect(
      cards.map(
        (c) => within(c).getByRole("heading", { level: 2 }).textContent,
      ),
    ).toEqual(["Equipo 1", "Equipo 2", "Otros"]);
    expect(within(cards[0]).getByTestId("dm-retention")).toHaveTextContent("–");
    expect(within(cards[0]).getByTestId("dm-signals")).toHaveTextContent("–");
    expect(within(cards[0]).getByTestId("dm-insights")).toHaveTextContent(
      "Todavía no hay datos suficientes para leer este equipo.",
    );
    expect(screen.getByTestId("dm-suppressed")).toHaveTextContent(
      "3 personas quedan fuera: sus DM tienen menos de 5 personas.",
    );
    expect(screen.queryByTestId("dm-without")).toBeNull();
  });

  it("says when nobody has a DM and how many people have none", () => {
    renderIn("es", <Dm360View data={data({ cards: [], withoutDm: 7 })} />);

    expect(screen.getByTestId("dm-empty")).toHaveTextContent(
      "Ningún DM tiene personas en este ciclo",
    );
    expect(screen.getByTestId("dm-without")).toHaveTextContent(
      "7 personas sin DM",
    );
  });
});

describe("Sparkline", () => {
  it("draws retention and engagement as small multiples, breaking the line where a cycle has no value, with a text twin", () => {
    renderIn("en", <Sparkline points={trend} />);

    const svg = screen.getByTestId("dm-spark-multiples");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg.getAttribute("aria-label")).toContain(
      "Retention: H1 2024: 4.0, H2 2024: no data, H1 2025: 2.0",
    );
    expect(svg.getAttribute("aria-label")).toContain(
      "Engagement: H1 2024: 3.5",
    );
    const retention = svg.querySelector('[data-series="retention"]')!;
    const engagement = svg.querySelector('[data-series="engagement"]')!;
    // Two separate points around the gap: no line, only dots (each cycle
    // on the same 1-5 scale, a small multiple per indicator).
    expect(retention.querySelector("path")).toBeNull();
    expect(retention.querySelectorAll("circle").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(engagement.querySelector("path")).toBeNull();
    expect(
      screen.getByTestId("dm-sparkline").querySelector("figcaption"),
    ).toHaveTextContent("Retention");
  });

  it("joins consecutive cycles with a line, one small multiple per indicator", () => {
    const { container } = renderIn(
      "es",
      <Sparkline
        points={[
          { ...trend[0] },
          {
            ...trend[2],
            cycleId: "c2",
            cycleName: "H2 2024",
            retention: 3,
            engagement: 3,
          },
        ]}
      />,
    );

    const retention = container.querySelector(
      '[data-series="retention"] path',
    )!;
    expect(retention.getAttribute("d")).toMatch(
      /^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/,
    );
    expect(
      container.querySelector('[data-series="engagement"] path'),
    ).not.toBeNull();
  });
});
