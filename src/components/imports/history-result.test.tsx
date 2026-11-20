import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { HistoryImportResult } from "@/modules/import-history/results";
import { HistoryResultLink } from "./history-link";
import { HistoryResult } from "./history-result";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = { es, en };

function renderIn(locale: "es" | "en", ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const result: HistoryImportResult = {
  runId: "run-1",
  entity: "assessment",
  status: "succeeded",
  decision: null,
  cycles: [
    {
      cycleId: "c-2023",
      name: "Evaluación de desempeño 2023",
      periodStart: "2023-11-28",
      periodEnd: "2023-12-15",
      rows: 22,
      written: 18,
      superseded: 1,
      participantsCreated: 19,
      requestsCreated: 38,
      requestsUpdated: 0,
      requestsUnchanged: 0,
      requestsRemoved: 0,
      answersCreated: 304,
      answersUpdated: 0,
      answersUnchanged: 0,
      answersRemoved: 0,
      issues: 3,
      mismatches: 4,
      pendingLabels: 0,
    },
    {
      cycleId: "c-2024",
      name: "Evaluación de desempeño 2024",
      periodStart: "2024-11-28",
      periodEnd: "2024-12-15",
      rows: 23,
      written: 23,
      superseded: 0,
      participantsCreated: 0,
      requestsCreated: 0,
      requestsUpdated: 5,
      requestsUnchanged: 35,
      requestsRemoved: 2,
      answersCreated: 0,
      answersUpdated: 7,
      answersUnchanged: 313,
      answersRemoved: 3,
      issues: 0,
      mismatches: 0,
      pendingLabels: 7,
    },
  ],
};

describe.each(["es", "en"] as const)("HistoryResult (%s)", (locale) => {
  const t = messages[locale].ImportHistory;

  const changes = (c: number, u: number, n: number, r: number) =>
    t.changes
      .replace("{created}", String(c))
      .replace("{updated}", String(u))
      .replace("{unchanged}", String(n))
      .replace("{removed}", String(r));

  it("lists each detected cycle with what the import created, updated, left unchanged and removed", () => {
    renderIn(locale, <HistoryResult result={result} />);

    expect(
      screen.getByRole("heading", { level: 1, name: t.title }),
    ).toBeInTheDocument();
    const table = screen.getByRole("group", { name: t.cycles });
    const rows = within(table).getAllByRole("article");
    expect(rows).toHaveLength(2);
    const first = rows[0];
    expect(
      within(first).getByText("Evaluación de desempeño 2023"),
    ).toBeInTheDocument();
    expect(first).toHaveTextContent("2023-11-28");
    expect(first).toHaveTextContent("2023-12-15");
    expect(first).toHaveTextContent(changes(38, 0, 0, 0));
    expect(first).toHaveTextContent(changes(304, 0, 0, 0));
    // Rows held for identity or superseded are not "written" (#132).
    expect(first).toHaveTextContent(
      t.rowsOf.replace("{written}", "18").replace("{rows}", "22"),
    );
    // Identity issues link to the queue; mismatches are counted.
    expect(within(first).getByRole("link", { name: "3" })).toHaveAttribute(
      "href",
      "/imports/identity",
    );
    expect(first).toHaveTextContent("4");
    expect(rows[1]).toHaveTextContent(changes(0, 5, 35, 2));
    expect(rows[1]).toHaveTextContent(changes(0, 7, 313, 3));
    // The totals: rows written apart from those read, and labels pending.
    const totals = screen.getByRole("group", { name: t.totals.label });
    expect(totals).toHaveTextContent(t.totals.rows);
    expect(totals).toHaveTextContent("41");
    expect(totals).toHaveTextContent(
      t.totals.rowsNote
        .replace("{rows}", "45")
        .replace("{retained}", "3")
        .replace("{superseded}", "1"),
    );
    expect(document.body).toHaveTextContent(
      locale === "es" ? "7 comentarios pendientes" : "7 comments waiting",
    );
    expect(screen.getByRole("link", { name: t.viewRun })).toHaveAttribute(
      "href",
      "/imports/runs/run-1",
    );
  });

  it("links a historical run's page to its result", () => {
    renderIn(locale, <HistoryResultLink runId="run-1" />);

    expect(screen.getByRole("link", { name: t.viewResult })).toHaveAttribute(
      "href",
      "/imports/history/run-1",
    );
  });
});
