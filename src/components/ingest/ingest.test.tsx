import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { RunDetail, RunListItem } from "@/modules/ingest/runs-queries";
import { RunDetailView } from "./run-detail";
import { RunsList } from "./runs-list";

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

const succeeded: RunListItem = {
  id: "run-1",
  sourceSystem: "bamboo_api",
  adapter: "fixture",
  entity: "employee",
  status: "succeeded",
  startedAt: new Date("2026-11-12T10:00:00Z"),
  finishedAt: new Date("2026-11-12T10:00:01.500Z"),
  counts: {
    read: 4,
    inserted: 3,
    updated: 1,
    unchanged: 0,
    deleted: 0,
    rejected: 1,
    issues: 1,
    ignored: 2,
  },
  issues: 2,
  error: null,
};
const failed: RunListItem = {
  ...succeeded,
  id: "run-2",
  adapter: "bamboo",
  status: "error",
  counts: { read: 2, inserted: 2 },
  issues: 0,
  error: "connection reset",
  startedAt: new Date("2026-11-12T09:00:00Z"),
  finishedAt: new Date("2026-11-12T09:02:05Z"),
};
const running: RunListItem = {
  ...succeeded,
  id: "run-3",
  status: "running",
  counts: {},
  issues: 0,
  finishedAt: null,
  startedAt: new Date("2026-11-12T11:00:00Z"),
};

const listProps = {
  filters: {},
  entities: ["employee", "goal"],
  sources: ["bamboo_api", "lake"],
  nextHref: null,
};

const cellTexts = (row: HTMLElement) =>
  Array.from(row.querySelectorAll("th, td")).map((c) => c.textContent?.trim());

describe("RunsList", () => {
  it.each([
    ["es", "Corridas de importación", "Exitosa", "Con error", "En curso"],
    ["en", "Import runs", "Succeeded", "Failed", "Running"],
  ] as const)(
    "renders one row per run with status and exact counts in %s",
    (locale, heading, okLabel, errorLabel, runningLabel) => {
      renderIn(
        locale,
        <RunsList {...listProps} runs={[succeeded, failed, running]} />,
      );

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows).toHaveLength(3);

      const [started, source, adapter, entity, status, ...rest] = cellTexts(
        rows[0],
      );
      expect(started).toMatch(/2026/);
      expect([source, adapter, entity, status]).toEqual([
        "bamboo_api",
        "fixture",
        "employee",
        okLabel,
      ]);
      // read, inserted, updated, unchanged, deleted, rejected, issues, ignored, log, duration
      expect(rest.slice(0, 9)).toEqual([
        "4",
        "3",
        "1",
        "0",
        "0",
        "1",
        "1",
        "2",
        "2",
      ]);
      expect(rest[9]).toMatch(/1[.,]5/);

      expect(cellTexts(rows[1])[4]).toBe(errorLabel);
      expect(cellTexts(rows[1]).slice(5, 14)).toEqual([
        "2",
        "2",
        "—",
        "—",
        "—",
        "—",
        "—",
        "—",
        "0",
      ]);
      expect(cellTexts(rows[1])[14]).toMatch(/2/);
      expect(cellTexts(rows[2])[4]).toBe(runningLabel);
      expect(cellTexts(rows[2])[14]).toBe("—");
    },
  );

  it("links every run to its detail", () => {
    renderIn("es", <RunsList {...listProps} runs={[succeeded, failed]} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("link")).toHaveAttribute(
      "href",
      "/imports/runs/run-1",
    );
    expect(within(rows[1]).getByRole("link")).toHaveAttribute(
      "href",
      "/imports/runs/run-2",
    );
  });

  it.each([
    ["es", "Todavía no hay corridas de importación."],
    ["en", "There are no import runs yet."],
  ] as const)("shows the empty state in %s", (locale, empty) => {
    renderIn(locale, <RunsList {...listProps} runs={[]} />);
    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it.each([
    ["es", "Ninguna corrida coincide con los filtros."],
    ["en", "No run matches the filters."],
  ] as const)(
    "tells apart an empty result from an empty log in %s",
    (locale, message) => {
      renderIn(
        locale,
        <RunsList {...listProps} runs={[]} filters={{ status: "error" }} />,
      );
      expect(screen.getByText(message)).toBeInTheDocument();
    },
  );

  it("keeps the active filters in the form", () => {
    renderIn(
      "en",
      <RunsList
        {...listProps}
        runs={[succeeded]}
        filters={{ source: "lake", entity: "goal", status: "error" }}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Source" })).toHaveValue(
      "lake",
    );
    expect(screen.getByRole("combobox", { name: "Entity" })).toHaveValue(
      "goal",
    );
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue(
      "error",
    );
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear" })).toHaveAttribute(
      "href",
      "/imports/runs",
    );
  });

  it("offers a way to the next page only when there is one", () => {
    const { unmount } = renderIn(
      "en",
      <RunsList
        {...listProps}
        runs={[succeeded]}
        nextHref="/imports/runs?cursor=abc"
      />,
    );
    expect(screen.getByRole("link", { name: "Older runs →" })).toHaveAttribute(
      "href",
      "/imports/runs?cursor=abc",
    );
    unmount();

    renderIn("en", <RunsList {...listProps} runs={[succeeded]} />);
    expect(
      screen.queryByRole("link", { name: "Older runs →" }),
    ).not.toBeInTheDocument();
  });
});

const detail: RunDetail = {
  id: "7f3c1c58-0000-4000-8000-000000000001",
  sourceSystem: "bamboo_api",
  adapter: "fixture",
  entity: "employee",
  status: "succeeded",
  startedAt: new Date("2026-11-12T10:00:00Z"),
  finishedAt: new Date("2026-11-12T10:00:01.500Z"),
  params: { entity: "employee", source: "fixture", dir: "fixtures" },
  counts: {
    read: 5,
    inserted: 3,
    updated: 1,
    unchanged: 0,
    deleted: 0,
    rejected: 1,
    issues: 2,
    ignored: 0,
  },
  rejects: [
    { sourceId: "105", reason: "employee has no name" },
    {
      sourceId: "102",
      reason:
        "identity_conflict: work_email=ana@example.com is held by person 9",
    },
    { sourceId: null, reason: "row without id" },
  ],
  rawRecordCount: 4,
  error: null,
};

describe("RunDetailView", () => {
  it.each([
    [
      "es",
      { title: "Corrida de importación", counts: "Conteos", read: "Leídos" },
      "Registros crudos guardados por esta corrida: 4",
    ],
    [
      "en",
      { title: "Import run", counts: "Counts", read: "Read" },
      "Raw records stored by this run: 4",
    ],
  ] as const)(
    "shows the exact counts, params and raw record count in %s",
    (locale, labels, raw) => {
      renderIn(locale, <RunDetailView run={detail} />);

      expect(
        screen.getByRole("heading", { level: 1, name: labels.title }),
      ).toBeInTheDocument();
      const counts = screen.getByRole("table", { name: labels.counts });
      const rows = within(counts).getAllByRole("row").slice(1);
      expect(rows.map(cellTexts)).toEqual([
        [labels.read, "5"],
        [expect.any(String), "3"],
        [expect.any(String), "1"],
        [expect.any(String), "0"],
        [expect.any(String), "0"],
        [expect.any(String), "1"],
        [expect.any(String), "2"],
        [expect.any(String), "0"],
      ]);
      expect(screen.getByText(raw)).toBeInTheDocument();
      expect(screen.getByText(/"dir": "fixtures"/)).toBeInTheDocument();
      expect(screen.getByText(detail.id)).toBeInTheDocument();
    },
  );

  it.each([
    [
      "es",
      "Rechazos e incidencias",
      "ID de origen",
      "Motivo",
      "Sin ID de origen",
    ],
    ["en", "Rejects and issues", "Source ID", "Reason", "No source ID"],
  ] as const)(
    "lists each reject with its source id and reason in %s",
    (locale, title, idHeader, reasonHeader, noId) => {
      renderIn(locale, <RunDetailView run={detail} />);

      const table = screen.getByRole("table", { name: title });
      expect(within(table).getByText(idHeader)).toBeInTheDocument();
      expect(within(table).getByText(reasonHeader)).toBeInTheDocument();
      const rows = within(table).getAllByRole("row").slice(1);
      expect(rows.map(cellTexts)).toEqual([
        ["105", "employee has no name"],
        [
          "102",
          "identity_conflict: work_email=ana@example.com is held by person 9",
        ],
        [noId, "row without id"],
      ]);
    },
  );

  it.each([
    ["es", "Esta corrida no tuvo rechazos ni incidencias."],
    ["en", "This run had no rejects or issues."],
  ] as const)("says so when there are no rejects in %s", (locale, none) => {
    renderIn(locale, <RunDetailView run={{ ...detail, rejects: [] }} />);
    expect(screen.getByText(none)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["es", "Con error", "Error"],
    ["en", "Failed", "Error"],
  ] as const)(
    "shows the failure of a run in error state in %s",
    (locale, badge, errorTitle) => {
      renderIn(
        locale,
        <RunDetailView
          run={{
            ...detail,
            status: "error",
            error: "connection reset",
            counts: { read: 2, inserted: 2 },
            rejects: [],
          }}
        />,
      );

      expect(screen.getByText(badge)).toBeInTheDocument();
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(errorTitle);
      expect(alert).toHaveTextContent("connection reset");
      // counts reached before the failure; the rest are not made up
      const counts = screen.getAllByRole("table")[0];
      expect(
        within(counts).getAllByRole("row").slice(1).map(cellTexts),
      ).toEqual([
        [expect.any(String), "2"],
        [expect.any(String), "2"],
        [expect.any(String), "—"],
        [expect.any(String), "—"],
        [expect.any(String), "—"],
        [expect.any(String), "—"],
        [expect.any(String), "—"],
        [expect.any(String), "—"],
      ]);
    },
  );

  it("a run still in progress has no end or duration yet", () => {
    renderIn(
      "en",
      <RunDetailView
        run={{ ...detail, status: "running", finishedAt: null, counts: {} }}
      />,
    );
    expect(screen.getByText("Finished").nextElementSibling).toHaveTextContent(
      "—",
    );
    expect(screen.getByText("Duration").nextElementSibling).toHaveTextContent(
      "—",
    );
  });

  it("links back to the list", () => {
    renderIn("en", <RunDetailView run={detail} />);
    expect(
      screen.getByRole("link", { name: "← Back to runs" }),
    ).toHaveAttribute("href", "/imports/runs");
  });
});
