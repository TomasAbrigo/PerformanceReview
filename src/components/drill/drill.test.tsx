import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import es from "@/messages/es.json";
import type { DrillResult } from "@/modules/insights/drill";
import { MetricCard } from "@/components/experience";
import { StackedBar100 } from "@/components/charts";
import { type DrillBase, DrillLink, drillBase, drillHref } from "./drill-link";
import { DrillView } from "./drill-view";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    scroll,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    scroll?: boolean;
  }) => (
    <a href={href} data-scroll={String(scroll)} {...rest}>
      {children}
    </a>
  ),
}));

const renderEs = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );

const base: DrillBase = {
  pathname: "/insights/executive",
  query: { cycle: "c1", mode: "both", drill: "goals:all" },
};

describe("drillHref", () => {
  it("keeps the page's params and replaces the drill", () => {
    expect(
      drillHref(base, { kind: "risk", retention: "low", engagement: "low" }),
    ).toBe("/insights/executive?cycle=c1&mode=both&drill=risk%3Alow%3Alow");
  });
  it("closes: the same page without the drill", () => {
    expect(drillHref(base, null)).toBe(
      "/insights/executive?cycle=c1&mode=both",
    );
    expect(drillHref({ pathname: "/x", query: { drill: "a" } }, null)).toBe(
      "/x",
    );
  });
});

describe("drillBase", () => {
  const sp = { cycle: "c1", dm: "Ana", santexLead: "Ana", drill: "goals:all" };
  it("keeps every param of the page for People", () => {
    expect(
      drillBase("/insights/360", sp, { personId: null, role: "hr" }),
    ).toEqual({ pathname: "/insights/360", query: sp });
  });
  it("never carries a DM or a Santex Lead for direction", () => {
    expect(
      drillBase("/insights/360", sp, { personId: null, role: "direction" }),
    ).toEqual({
      pathname: "/insights/360",
      query: { cycle: "c1", drill: "goals:all" },
    });
  });
});

describe("DrillLink", () => {
  it("is a link that says it opens a dialog, named by its label", () => {
    renderEs(
      <DrillLink
        base={base}
        drill={{ kind: "theme", theme: "calidad" }}
        label="Calidad: ver comentarios"
      >
        Calidad
      </DrillLink>,
    );
    const link = screen.getByRole("link", { name: "Calidad: ver comentarios" });
    expect(link).toHaveAttribute("aria-haspopup", "dialog");
    expect(link).toHaveAttribute("data-drill", "theme:calidad");
    expect(link.getAttribute("href")).toContain("drill=theme%3Acalidad");
  });

  it("turns chart segments into drill links (Enter follows a link)", () => {
    renderEs(
      <StackedBar100
        label="Retención"
        series={[
          { key: "1", label: "1", fill: "", ink: "" },
          { key: "2", label: "2", fill: "", ink: "" },
        ]}
        rows={[
          { key: "retention", label: "Retención", values: { 1: 1, 2: 3 } },
        ]}
        drillOf={(row, v) => ({
          base,
          drill: {
            kind: "indicator",
            indicator: "retention",
            value: Number(v),
          },
        })}
      />,
    );
    const links = within(screen.getByRole("group")).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("data-drill"))).toEqual([
      "indicator:retention:1",
      "indicator:retention:2",
    ]);
  });
});

describe("MetricCard with context", () => {
  it("shows the scale, the tone in words, the delta and drills from the value", () => {
    renderEs(
      <MetricCard
        label="Retención"
        value="3,4"
        status="watch"
        scale={{ value: 3.4, min: 1, max: 5, label: "Retención: 3,4 de 5" }}
        delta={{ value: -0.2, text: "-0,2 vs. ciclo anterior" }}
        drill={{
          base,
          drill: { kind: "indicator", indicator: "retention", value: null },
          label: "Ver las 9 personas",
        }}
      />,
    );
    const card = screen.getByRole("region", { name: "Retención" });
    expect(card).toHaveAttribute("data-tone", "watch");
    expect(within(card).getByText("Atención")).toBeVisible();
    const meter = within(card).getByRole("meter", {
      name: "Retención: 3,4 de 5",
    });
    expect(meter).toHaveAttribute("aria-valuemin", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "5");
    expect(meter).toHaveAttribute("aria-valuenow", "3.4");
    expect(within(card).getByTestId("delta")).toHaveClass("delta-bad");
    expect(
      within(card).getByRole("link", { name: "Ver las 9 personas" }),
    ).toHaveTextContent("3,4");
  });
  it("a plain card stays plain", () => {
    renderEs(<MetricCard label="Participantes" value={9} />);
    const card = screen.getByRole("region", { name: "Participantes" });
    expect(card).not.toHaveAttribute("data-tone");
    expect(within(card).queryByRole("meter")).toBeNull();
    expect(within(card).queryByRole("link")).toBeNull();
  });
});

describe("DrillView", () => {
  const people: DrillResult = {
    drill: { kind: "risk", retention: "low", engagement: "low" },
    unit: "people",
    total: 2,
    people: [
      {
        personId: "p1",
        name: "Ana Prieto",
        department: "Ingeniería",
        managerName: "Marta Quiroga",
        facts: [
          { key: "retention", value: 2 },
          { key: "engagement", value: 1 },
        ],
        href: "/insights/indicators/trend?person=p1",
      },
    ],
    comments: null,
    breakdownBy: "department",
    breakdown: [{ key: "Ingeniería", others: false, n: 2 }],
    minGroupSize: null,
    moreHref: "/insights/indicators",
    truncated: false,
  };
  it("People: the count, the people with links and a CSV", () => {
    renderEs(<DrillView result={people} />);
    expect(screen.getByTestId("drill-total")).toHaveTextContent("2personas");
    expect(screen.getByRole("link", { name: "Ana Prieto" })).toHaveAttribute(
      "href",
      "/insights/indicators/trend?person=p1",
    );
    const csv = screen.getByRole("link", { name: /Descargar CSV/ });
    expect(decodeURIComponent(csv.getAttribute("href") ?? "")).toContain(
      '"Ana Prieto","Ingeniería","Marta Quiroga","2","1"',
    );
  });
  it("direction: counts by area only, and says why", () => {
    renderEs(
      <DrillView
        result={{
          ...people,
          people: null,
          total: null,
          breakdown: [{ key: "Ingeniería", others: false, n: 6 }],
          minGroupSize: 5,
        }}
      />,
    );
    expect(screen.queryByText("Ana Prieto")).toBeNull();
    expect(screen.queryAllByTestId("drill-person")).toHaveLength(0);
    expect(screen.getByTestId("drill-total")).toHaveTextContent(
      "revelaría grupos de menos de 5 personas",
    );
    expect(screen.getByTestId("drill-breakdown")).toHaveTextContent(
      "Ingeniería6",
    );
    expect(screen.getByText(/nunca nombres/)).toBeVisible();
  });
});
