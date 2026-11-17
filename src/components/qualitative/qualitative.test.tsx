import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { CommentRow } from "@/modules/qualitative-analysis/types";
import { CommentsTable } from "./comments-table";
import { ImportLabelsForm } from "./import-form";
import { parseQualitativeParams } from "./params";
import { RunButton } from "./run-button";
import { ByDimension, Indicators, Themes, Trend } from "./views";

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
const counts = { positive: 3, constructive: 1, negative: 1, total: 5 };
const comment: CommentRow = {
  answerId: "a1",
  cycleName: "2023",
  personName: "Ana Ejemplo",
  relationship: "manager",
  dimension: "strengths",
  text: "Muy buena comunicación",
  sentiment: "positive",
  themes: ["comunicacion"],
  confidence: 0.8,
  source: "mock",
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
    const charts = screen.getAllByRole("img");
    expect(charts).toHaveLength(2);
    expect(screen.getAllByTestId("sentiment-bar")).toHaveLength(2);
    expect(
      screen.getByText(locale === "es" ? "Fortalezas" : "Strengths"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(locale === "es" ? "Positivo" : "Positive").length,
    ).toBeGreaterThan(0);
  });

  it("themes with quotes, indicators and empty states", () => {
    renderIn(
      locale,
      <>
        <Themes
          themes={[
            { theme: "comunicacion", count: 2, quotes: ["[P1] avisa antes"] },
          ]}
        />
        <Indicators rows={[]} />
      </>,
    );
    expect(screen.getByText("comunicacion")).toBeInTheDocument();
    expect(screen.getByText("[P1] avisa antes")).toBeInTheDocument();
    expect(
      screen.getByText(locale === "es" ? /No hay respuestas/ : /No retention/),
    ).toBeInTheDocument();
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
      screen.getByRole("table", { name: "Comentarios etiquetados" }),
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
    const table = await screen.findByRole("table", { name: "Unmatched rows" });
    expect(within(table).getByText("Unknown person")).toBeInTheDocument();
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
      aggregate: true,
    });
  });
});
