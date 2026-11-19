import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { CommentRow } from "@/modules/qualitative-analysis/types";
import { CommentsTable } from "./comments-table";
import { ImportLabelsForm } from "./import-form";
import { parseQualitativeParams, withGroupBy, withSide } from "./params";
import { RunButton } from "./run-button";
import { dimensionLabels } from "./dimension-labels";
import { QualitativeFilters } from "./filters";
import { SideToggle } from "./side-toggle";
import { ByDimension, ByGroup, Indicators, Kpis, Themes, Trend } from "./views";

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
  neutral: 2,
  mixed: 1,
  negative: 1,
  total: 8,
};
const comment: CommentRow = {
  answerId: "a1",
  cycleName: "2023",
  periodStart: "2023-03-29",
  periodEnd: "2023-09-25",
  personName: "Ana Ejemplo",
  relationship: "manager",
  dimension: "strengths",
  text: "Muy buena comunicación",
  sentiment: "positive",
  themes: ["comunicacion"],
  substance: "specific",
  signals: [],
  confidence: 0.8,
  source: "anthropic",
  demo: false,
};

describe.each(locales)("qualitative views (%s)", (locale) => {
  it("stacked bars per dimension and per cycle, with the legend", () => {
    renderIn(
      locale,
      <>
        <ByDimension
          rows={[{ dimension: "strengths", ...counts }]}
          dimensionLabel={{
            strengths: locale === "es" ? "Fortalezas" : "Strengths",
          }}
        />
        <Trend
          points={[
            {
              cycleId: "c",
              cycleName: "Ciclo 2023",
              periodEnd: "2023-12-31",
              ...counts,
            },
          ]}
        />
      </>,
    );
    expect(
      screen.getAllByRole("group", { name: /Barras apiladas|Stacked bars/ }),
    ).toHaveLength(2);
    expect(screen.getAllByTestId("sentiment-bar")).toHaveLength(2);
    expect(
      screen.getAllByText(locale === "es" ? "Fortalezas" : "Strengths").length,
    ).toBeGreaterThan(0);
    // Legend: the five sentiments, in order, so color is never the only cue.
    const names =
      locale === "es"
        ? ["Positivo", "Constructivo", "Neutral", "Mixto", "Negativo"]
        : ["Positive", "Constructive", "Neutral", "Mixed", "Negative"];
    for (const legend of screen.getAllByRole("list", {
      name: locale === "es" ? "Leyenda de sentimientos" : "Sentiment legend",
    })) {
      expect(
        within(legend)
          .getAllByRole("listitem")
          .map((li) => li.textContent),
      ).toEqual(names);
    }
    // The bar's tooltip names the five counts.
    expect(
      screen.getAllByTestId("sentiment-bar")[0].getAttribute("title"),
    ).toMatch(locale === "es" ? /2 neutrales, 1 mixtos/ : /2 neutral, 1 mixed/);
  });

  it("offers the bars as a table too (counts per sentiment)", () => {
    renderIn(
      locale,
      <ByDimension
        rows={[{ dimension: "strengths", ...counts }]}
        dimensionLabel={{ strengths: "S" }}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(7);
    expect(within(table).getByText("8")).toBeInTheDocument();
  });

  it("shows the total and each sentiment's share, count and scale; values open their comments", () => {
    renderIn(
      locale,
      <Kpis
        counts={counts}
        drills={{
          base: { pathname: "/insights/qualitative", query: {} },
          scope: {},
        }}
        thresholds={{ goodPct: 80, watchPct: 60 }}
      />,
    );
    const kpis = screen.getByTestId("qualitative-kpis");
    const total = within(kpis).getByRole("region", { name: "Total" });
    expect(within(total).getByText("8")).toBeInTheDocument();
    const positive = within(kpis).getByRole("region", {
      name: locale === "es" ? "Positivos" : "Positive",
    });
    expect(positive).toHaveTextContent(locale === "es" ? "38 %" : "38%");
    expect(positive).toHaveTextContent(
      locale === "es" ? "3 comentarios" : "3 comments",
    );
    expect(within(positive).getByRole("meter")).toBeInTheDocument();
    expect(within(positive).getByRole("link").getAttribute("data-drill")).toBe(
      "comments:sentiment=positive",
    );
    // Negative and mixed shares carry a tone.
    const negative = within(kpis).getByRole("region", {
      name: locale === "es" ? "Negativos" : "Negative",
    });
    expect(negative.getAttribute("data-tone")).toBe("good");
    expect(within(kpis).getAllByRole("region")).toHaveLength(6);
  });

  it("themes with quotes, indicators and empty states", () => {
    renderIn(
      locale,
      <>
        <Themes
          themes={[
            {
              theme: "comunicacion",
              count: 8,
              sentiment: counts,
              quotes: ["[P1] avisa antes"],
            },
          ]}
        />
        <Indicators rows={[]} />
      </>,
    );
    expect(
      screen.getByText(/^(comunicaci[oó]n|communication)$/i),
    ).toBeInTheDocument();
    expect(screen.getByText("[P1] avisa antes")).toBeInTheDocument();
    // Each theme carries its stacked sentiment.
    expect(screen.getByTestId("theme-sentiment")).toBeInTheDocument();
    expect(
      screen.getByText(locale === "es" ? /No hay respuestas/ : /No retention/),
    ).toBeInTheDocument();
  });
});

describe("CommentsTable list", () => {
  const rows: CommentRow[] = [
    { ...comment, relationship: "self", themes: ["equipo", "cultura"] },
    {
      ...comment,
      answerId: "a2",
      relationship: "manager",
      sentiment: "mixed",
      confidence: null,
      source: "human",
    },
  ];
  it("tags the side, and shows person, dimension, period, sentiment and themes", () => {
    renderIn(
      "es",
      <CommentsTable
        rows={rows}
        dimensionLabel={{ strengths: "Fortalezas" }}
      />,
    );
    const table = screen.getByRole("group", {
      name: "Comentarios etiquetados",
    });
    const [self, manager] = within(table).getAllByRole("article");
    expect(within(self).getByText("PROPIO")).toBeInTheDocument();
    expect(within(manager).getByText("MANAGER")).toBeInTheDocument();
    expect(within(self).getByText("Ana Ejemplo")).toBeInTheDocument();
    expect(within(self).getByText("Fortalezas")).toBeInTheDocument();
    expect(within(self).getByTitle(/29 mar 2023/)).toBeInTheDocument();
    expect(within(self).getByText("Positivo")).toBeInTheDocument();
    expect(within(manager).getByText("Mixto")).toBeInTheDocument();
    expect(
      within(within(self).getByRole("list", { name: "Temas" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["equipo", "cultura"]);
  });
  it("tags are in English too", () => {
    renderIn("en", <CommentsTable rows={rows} dimensionLabel={{}} />);
    expect(screen.getByText("SELF")).toBeInTheDocument();
    expect(screen.getByText("MANAGER")).toBeInTheDocument();
  });
});

describe("SideToggle", () => {
  it.each([
    ["es", ["Todos", "Propios", "Manager"]],
    ["en", ["All", "Own", "Manager"]],
  ] as const)(
    "links the three sides, marking the current one (%s)",
    (locale, names) => {
      renderIn(
        locale,
        <SideToggle
          current="self"
          hrefFor={(side) => `/insights/qualitative?side=${side ?? "all"}`}
        />,
      );
      const links = screen.getAllByRole("link");
      expect(links.map((l) => l.textContent)).toEqual([...names]);
      expect(links.map((l) => l.getAttribute("href"))).toEqual([
        "/insights/qualitative?side=all",
        "/insights/qualitative?side=self",
        "/insights/qualitative?side=manager",
      ]);
      expect(
        links.filter((l) => l.getAttribute("aria-current") === "true"),
      ).toEqual([links[1]]);
    },
  );
});

describe("QualitativeFilters", () => {
  it("offers the five sentiments and keeps the side in the form", () => {
    const { container } = renderIn(
      "es",
      <QualitativeFilters
        params={{ aggregate: false, side: "manager" }}
        cycles={[]}
        cycle="all"
        departments={[]}
        dimensions={["strengths"]}
        themes={[]}
        dimensionLabel={{ strengths: "Fortalezas" }}
        showAggregate={false}
      />,
    );
    const sentiment = screen.getByLabelText("Tono");
    expect(
      within(sentiment)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "Todos",
      "Positivo",
      "Constructivo",
      "Neutral",
      "Mixto",
      "Negativo",
    ]);
    expect(
      container.querySelector('input[type="hidden"][name="side"]'),
    ).toHaveValue("manager");
    expect(screen.getByLabelText("Dimensión")).toBeInTheDocument();
  });
});

describe("dimensionLabels", () => {
  const base = {
    names: { strengths: "Fortalezas", valued: "Reconocimiento de valor" },
    custom: (n: string) => `Pregunta personalizada ${n}`,
    prompts: {
      weird_key: { es: "¿Algo raro?", en: "Something odd?" },
      custom_1: { es: "no se usa", en: "unused" },
    },
    locale: "es" as const,
  };
  it("known keys use their message, custom_N and unknown ones their question prompt, custom_N without one its pattern", () => {
    expect(
      dimensionLabels(
        ["strengths", "custom_1", "custom_2", "weird_key", "zzz"],
        base,
      ),
    ).toEqual({
      strengths: "Fortalezas",
      custom_1: "no se usa",
      custom_2: "Pregunta personalizada 2",
      weird_key: "¿Algo raro?",
      zzz: "zzz",
    });
    expect(
      dimensionLabels(["weird_key"], { ...base, locale: "en" }).weird_key,
    ).toBe("Something odd?");
  });
});

describe("CommentsTable", () => {
  it("is read-only without a correct action", () => {
    renderIn(
      "es",
      <CommentsTable
        rows={[comment]}
        dimensionLabel={{ strengths: "Fortalezas" }}
      />,
    );
    expect(
      screen.getByRole("group", { name: "Comentarios etiquetados" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Corregir" })).toBeNull();
  });

  it("HR corrects a label inline", async () => {
    const correct = vi.fn().mockResolvedValue({ ok: true });
    renderIn(
      "en",
      <CommentsTable rows={[comment]} dimensionLabel={{}} correct={correct} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Correct" }));
    fireEvent.change(screen.getByLabelText("Sentiment"), {
      target: { value: "negative" },
    });
    fireEvent.change(screen.getByLabelText("Themes (separated by ;)"), {
      target: { value: "a; b" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() =>
      expect(correct).toHaveBeenCalledWith("a1", {
        sentiment: "negative",
        themes: ["a", "b"],
        reason: "wrong",
      }),
    );
  });
});

describe("RunButton / ImportLabelsForm / params", () => {
  it("shows the run counts", async () => {
    const run = vi.fn().mockResolvedValue({
      ok: true,
      provider: "mock",
      total: 4,
      analyzed: 3,
      cached: 1,
      corrected: 0,
    });
    renderIn("es", <RunButton cycleId="c" run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Correr análisis" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "4 textos: 3 analizados",
    );
    expect(run).toHaveBeenCalledWith("c");
  });

  it("lists unmatched rows after an import", async () => {
    const importLabels = vi.fn().mockResolvedValue({
      ok: true,
      total: 2,
      matched: 1,
      unmatched: [
        { line: 2, employee: "X", cycle: "C", reason: "unknown_person" },
      ],
    });
    renderIn("en", <ImportLabelsForm importLabels={importLabels} />);
    fireEvent.submit(
      screen.getByRole("button", { name: "Import labels" }).closest("form")!,
    );
    const table = await screen.findByRole("group", { name: "Unmatched rows" });
    expect(within(table).getByText("Unknown person")).toBeInTheDocument();
  });

  it("builds the page URL with the side replaced and the other filters kept", () => {
    const params = parseQualitativeParams({
      cycle: "c1",
      sentiment: "mixed",
      side: "self",
      aggregate: "1",
    });
    expect(withSide(params, "manager")).toBe(
      "/insights/qualitative?cycle=c1&sentiment=mixed&side=manager&aggregate=1",
    );
    expect(withSide(params, undefined)).toBe(
      "/insights/qualitative?cycle=c1&sentiment=mixed&aggregate=1",
    );
    expect(withSide(parseQualitativeParams({}), undefined)).toBe(
      "/insights/qualitative",
    );
  });

  it("parses the URL params", () => {
    expect(
      parseQualitativeParams({ sentiment: "bad", aggregate: "1", cycle: " " }),
    ).toEqual({
      cycle: undefined,
      department: undefined,
      dimension: undefined,
      sentiment: undefined,
      theme: undefined,
      side: undefined,
      aggregate: true,
    });
    expect(
      parseQualitativeParams({ side: "self", sentiment: "mixed" }),
    ).toMatchObject({ side: "self", sentiment: "mixed" });
    expect(parseQualitativeParams({ side: "peer" }).side).toBeUndefined();
  });
});

describe("org cuts in the qualitative view", () => {
  const sentiment = {
    positive: 2,
    constructive: 1,
    neutral: 0,
    mixed: 0,
    negative: 1,
    total: 4,
  };

  it("the by-group panel names each group with its people, numbering the teams that come without a name", () => {
    renderIn(
      "es",
      <ByGroup
        rows={[
          { key: "Cuenta A", label: "Cuenta A", participants: 3, ...sentiment },
          { key: "g1", label: null, participants: 5, ...sentiment },
          { key: "g2", label: null, participants: 5, ...sentiment },
          { key: null, label: null, participants: 1, ...sentiment },
        ]}
      />,
    );

    const panel = screen.getByTestId("sentiment-by-group");
    expect(
      within(panel).getByRole("heading", {
        name: "¿Qué equipos reciben comentarios más negativos?",
      }),
    ).toBeInTheDocument();
    const labels = [
      ...panel.querySelectorAll(
        "table tbody th, [data-testid=sentiment-bar] > span",
      ),
    ]
      .map((n) => n.textContent)
      .filter((t) => t?.includes("·"));
    expect(labels).toEqual(
      expect.arrayContaining([
        "Cuenta A · 3 personas",
        "Equipo 1 · 5 personas",
        "Equipo 2 · 5 personas",
        "Sin asignar · 1 persona",
      ]),
    );
  });

  it("says there is nothing to show without groups", () => {
    renderIn("en", <ByGroup rows={[]} />);

    expect(screen.getByTestId("sentiment-by-group")).toBeInTheDocument();
    expect(screen.getByText(/No/)).toBeInTheDocument();
  });

  it("the filters offer the org selects and the links keep them", () => {
    renderIn(
      "es",
      <QualitativeFilters
        params={parseQualitativeParams({ account: "Cuenta A", groupBy: "dm" })}
        cycles={[]}
        cycle="all"
        departments={[]}
        dimensions={[]}
        themes={[]}
        dimensionLabel={{}}
        showAggregate={false}
        org={{
          accounts: ["Cuenta A"],
          projects: [],
          dms: ["Diego"],
          santexLeads: [],
        }}
      />,
    );

    expect(screen.getByLabelText("Cuenta")).toHaveValue("Cuenta A");
    expect(screen.getByLabelText("DM")).toBeInTheDocument();
    expect(
      parseQualitativeParams({ account: "A", groupBy: "dm" }),
    ).toMatchObject({
      account: "A",
      groupBy: "dm",
    });
    expect(parseQualitativeParams({ groupBy: "nope" }).groupBy).toBeUndefined();
    expect(
      withGroupBy(
        parseQualitativeParams({ account: "Cuenta A", side: "self" }),
        "project",
      ),
    ).toBe("/insights/qualitative?account=Cuenta+A&groupBy=project&side=self");
  });
});
