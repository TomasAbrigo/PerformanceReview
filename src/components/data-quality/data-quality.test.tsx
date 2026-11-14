import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  DATA_QUALITY_KEYS,
  type DataQualityIndicator,
} from "@/modules/analytics/data-quality";
import { DataQualityPanel } from "./data-quality-panel";
import { ExportCsvLink } from "./export-csv-link";
import { IndicatorDetail } from "./indicator-detail";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
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

/** An indicator of every key, all empty. */
const emptyIndicators = (): DataQualityIndicator[] =>
  DATA_QUALITY_KEYS.map(
    (key) => ({ key, count: 0, items: [] }) as DataQualityIndicator,
  );

const noManager: DataQualityIndicator = {
  key: "no_manager",
  count: 2,
  items: [
    {
      id: "p1",
      displayName: "Ana García",
      workEmail: "ana@example.com",
      managerRaw: null,
      isTop: true,
    },
    {
      id: "p2",
      displayName: "Zoe Sola",
      workEmail: null,
      managerRaw: "Nadie, Alguien",
      isTop: false,
    },
  ],
};

const identity: DataQualityIndicator = {
  key: "identity_open",
  count: 3,
  items: [],
};

describe("DataQualityPanel", () => {
  it.each([
    ["es", "Calidad de datos", "Personas sin manager", "Ver casos", "2 casos"],
    ["en", "Data quality", "People without a manager", "View cases", "2 cases"],
  ] as const)(
    "shows each indicator with its count and a link to its cases in %s",
    (locale, heading, title, view, count) => {
      renderIn(
        locale,
        <DataQualityPanel
          indicators={[
            identity,
            noManager,
            { key: "failed_runs", count: 0, items: [] },
          ]}
        />,
      );

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      const card = screen
        .getByRole("heading", { level: 2, name: title })
        .closest("article")!;
      expect(within(card).getByText(count)).toBeInTheDocument();
      const link = within(card).getByRole("link", {
        name: new RegExp(view),
      });
      expect(link).toHaveAttribute("href", "/data-quality/no_manager");
    },
  );

  it("sends open identity cases straight to the identity queue", () => {
    renderIn("es", <DataQualityPanel indicators={[identity, noManager]} />);
    const card = screen
      .getByRole("heading", { level: 2, name: "Identidades sin resolver" })
      .closest("article")!;
    expect(within(card).getByText("3 casos")).toBeInTheDocument();
    expect(within(card).getByRole("link")).toHaveAttribute(
      "href",
      "/imports/identity",
    );
  });

  it.each([
    ["es", "Sin casos", "Todo en orden: ningún indicador tiene casos."],
    ["en", "No cases", "All clear: no indicator has cases."],
  ] as const)(
    "shows a clear state without links when nothing is flagged in %s",
    (locale, none, clear) => {
      renderIn(locale, <DataQualityPanel indicators={emptyIndicators()} />);
      expect(screen.getByText(clear)).toBeInTheDocument();
      expect(screen.getAllByText(none)).toHaveLength(emptyIndicators().length);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    },
  );

  it("renders an empty panel without indicators", () => {
    renderIn("es", <DataQualityPanel indicators={[]} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Calidad de datos" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });
});

describe("IndicatorDetail", () => {
  it.each([
    ["es", "Personas sin manager", "Tope", "← Volver al panel"],
    ["en", "People without a manager", "Top", "← Back to the panel"],
  ] as const)(
    "lists the people, badges the top of the org and links to each in %s",
    (locale, title, top, back) => {
      renderIn(locale, <IndicatorDetail indicator={noManager} />);

      expect(
        screen.getByRole("heading", { level: 1, name: title }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: back })).toHaveAttribute(
        "href",
        "/data-quality",
      );
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(
        within(rows[0]).getByRole("link", { name: "Ana García" }),
      ).toHaveAttribute("href", "/people/p1");
      expect(within(rows[0]).getByText(top)).toBeInTheDocument();
      expect(within(rows[1]).queryByText(top)).not.toBeInTheDocument();
      expect(within(rows[1]).getByText("Nadie, Alguien")).toBeInTheDocument();
    },
  );

  it("groups participants by cycle with a link to the cycle", () => {
    renderIn(
      "es",
      <IndicatorDetail
        indicator={{
          key: "participants_no_manager",
          count: 3,
          items: [
            {
              id: "a",
              cycleId: "c1",
              cycleName: "Ciclo A",
              personId: "p1",
              displayName: "Bruno Pérez",
            },
            {
              id: "b",
              cycleId: "c1",
              cycleName: "Ciclo A",
              personId: "p2",
              displayName: "Ana García",
            },
            {
              id: "c",
              cycleId: "c2",
              cycleName: "Ciclo B",
              personId: "p3",
              displayName: "Carla Romero",
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Ciclo A" })).toHaveAttribute(
      "href",
      "/cycles/c1",
    );
    expect(screen.getByRole("link", { name: "Ciclo B" })).toHaveAttribute(
      "href",
      "/cycles/c2",
    );
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);
    expect(within(tables[0]).getAllByRole("row")).toHaveLength(3);
    expect(
      within(tables[1]).getByRole("link", { name: "Carla Romero" }),
    ).toHaveAttribute("href", "/people/p3");
    expect(screen.getByText("2 participantes")).toBeInTheDocument();
  });

  it.each([
    ["es", "Superposición", "Hueco", "Sin fin"],
    ["en", "Overlap", "Gap", "No end"],
  ] as const)(
    "labels job-history overlaps and gaps in %s",
    (locale, overlap, gap, openEnd) => {
      renderIn(
        locale,
        <IndicatorDetail
          indicator={{
            key: "job_history_overlap_gap",
            count: 2,
            items: [
              {
                id: "j1",
                personId: "p1",
                displayName: "Eli Gómez",
                kind: "overlap",
                from: "2021-06-01",
                to: null,
              },
              {
                id: "j2",
                personId: "p2",
                displayName: "Fede Ruiz",
                kind: "gap",
                from: "2021-01-01",
                to: "2021-03-01",
              },
            ],
          }}
        />,
      );
      const rows = screen.getAllByRole("row").slice(1);
      expect(within(rows[0]).getByText(overlap)).toBeInTheDocument();
      expect(within(rows[0]).getByText("2021-06-01")).toBeInTheDocument();
      expect(within(rows[0]).getByText(openEnd)).toBeInTheDocument();
      expect(within(rows[1]).getByText(gap)).toBeInTheDocument();
      expect(within(rows[1]).getByText("2021-03-01")).toBeInTheDocument();
    },
  );

  it("links failed runs to the run and shows the error", () => {
    renderIn(
      "en",
      <IndicatorDetail
        indicator={{
          key: "failed_runs",
          count: 1,
          items: [
            {
              id: "r1",
              entity: "goal",
              sourceSystem: "bamboo_api",
              startedAt: new Date("2026-11-12T10:00:00Z"),
              error: "boom",
            },
          ],
        }}
      />,
    );
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByRole("link")).toHaveAttribute(
      "href",
      "/imports/runs/r1",
    );
    expect(within(row).getByText("goal")).toBeInTheDocument();
    expect(within(row).getByText("boom")).toBeInTheDocument();
  });

  it("shows the reviewer next to the snapshot manager of each mismatch", () => {
    renderIn(
      "en",
      <IndicatorDetail
        indicator={{
          key: "reviewer_mismatch",
          count: 1,
          items: [
            {
              id: "q1",
              cycleId: "c1",
              cycleName: "Cycle A",
              personId: "p1",
              displayName: "Carla Romero",
              reviewerPersonId: "p2",
              reviewerName: "Bruno Pérez",
              snapManagerId: "p3",
              snapManagerName: "Ana García",
            },
          ],
        }}
      />,
    );
    const row = screen.getAllByRole("row")[1];
    expect(
      within(row).getByRole("link", { name: "Carla Romero" }),
    ).toHaveAttribute("href", "/people/p1");
    expect(
      within(row).getByRole("link", { name: "Bruno Pérez" }),
    ).toHaveAttribute("href", "/people/p2");
    expect(
      within(row).getByRole("link", { name: "Ana García" }),
    ).toHaveAttribute("href", "/people/p3");
    expect(
      screen.getByRole("columnheader", { name: "Snapshot manager" }),
    ).toBeInTheDocument();
  });

  it("links goals to their owner", () => {
    renderIn(
      "es",
      <IndicatorDetail
        indicator={{
          key: "goals_without_employment",
          count: 1,
          items: [
            {
              id: "g1",
              personId: "p9",
              displayName: "Inés Mora",
              title: "Meta",
            },
          ],
        }}
      />,
    );
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Meta")).toBeInTheDocument();
    expect(
      within(row).getByRole("link", { name: "Inés Mora" }),
    ).toHaveAttribute("href", "/people/p9");
  });

  it.each([
    ["es", "No hay casos."],
    ["en", "No cases."],
  ] as const)("shows an empty state in %s", (locale, empty) => {
    renderIn(
      locale,
      <IndicatorDetail
        indicator={{ key: "duplicate_names", count: 0, items: [] }}
      />,
    );
    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("covers every indicator key with a title and description in both languages", () => {
    for (const key of DATA_QUALITY_KEYS) {
      for (const m of [es, en]) {
        const entry = (
          m.DataQuality.indicators as Record<
            string,
            { title: string; description: string }
          >
        )[key];
        expect(entry?.title).toBeTruthy();
        expect(entry?.description).toBeTruthy();
      }
    }
  });
});

describe("ExportCsvLink", () => {
  it.each([
    ["es", "Exportar CSV"],
    ["en", "Export CSV"],
  ] as const)("downloads the entity as CSV in %s", (locale, label) => {
    renderIn(locale, <ExportCsvLink file="people" />);
    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", "/api/v1/export/people.csv");
    expect(link).toHaveAttribute("download");
  });

  it("carries the current filters and drops the empty ones", () => {
    renderIn(
      "es",
      <ExportCsvLink
        file="ingest-runs"
        params={{ status: "error", entity: "", source: undefined }}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/api/v1/export/ingest-runs.csv?status=error",
    );
  });
});
