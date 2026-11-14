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
  cycles: [
    {
      cycleId: "c-2023",
      name: "Evaluación de desempeño 2023",
      periodStart: "2023-11-28",
      periodEnd: "2023-12-15",
      rows: 22,
      participantsCreated: 19,
      requestsCreated: 38,
      requestsUnchanged: 0,
      answersCreated: 304,
      answersUnchanged: 0,
      issues: 3,
      mismatches: 4,
    },
    {
      cycleId: "c-2024",
      name: "Evaluación de desempeño 2024",
      periodStart: "2024-11-28",
      periodEnd: "2024-12-15",
      rows: 23,
      participantsCreated: 0,
      requestsCreated: 0,
      requestsUnchanged: 40,
      answersCreated: 0,
      answersUnchanged: 320,
      issues: 0,
      mismatches: 0,
    },
  ],
};

describe.each(["es", "en"] as const)("HistoryResult (%s)", (locale) => {
  const t = messages[locale].ImportHistory;

  it("lists each detected cycle with what the import created and left unchanged", () => {
    renderIn(locale, <HistoryResult result={result} />);

    expect(
      screen.getByRole("heading", { level: 1, name: t.title }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table", { name: t.cycles });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const first = rows[1];
    expect(
      within(first).getByRole("link", {
        name: "Evaluación de desempeño 2023",
      }),
    ).toHaveAttribute("href", "/cycles/c-2023");
    expect(first).toHaveTextContent("2023-11-28");
    expect(first).toHaveTextContent("2023-12-15");
    expect(first).toHaveTextContent(
      t.createdUnchanged.replace("{created}", "38").replace("{unchanged}", "0"),
    );
    expect(first).toHaveTextContent(
      t.createdUnchanged
        .replace("{created}", "304")
        .replace("{unchanged}", "0"),
    );
    // Identity issues link to the queue; mismatches are counted.
    expect(within(first).getByRole("link", { name: "3" })).toHaveAttribute(
      "href",
      "/imports/identity",
    );
    expect(first).toHaveTextContent("4");
    expect(rows[2]).toHaveTextContent(
      t.createdUnchanged
        .replace("{created}", "0")
        .replace("{unchanged}", "320"),
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
