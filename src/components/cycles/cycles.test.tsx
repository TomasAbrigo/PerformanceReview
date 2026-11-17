import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { type CycleDetailData, CycleDetailView } from "./cycle-detail";
import { CyclesList } from "./cycles-list";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = { es, en };
function renderIn(locale: "es" | "en", ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

// ------------------------------------------------------------------ list

describe("CyclesList", () => {
  it.each([
    ["es", "Ciclos de evaluación", "Recolección"],
    ["en", "Review cycles", "Collecting"],
  ] as const)("lists cycles with status and count in %s", (locale, h, st) => {
    renderIn(
      locale,
      <CyclesList
        cycles={[
          {
            id: "c1",
            name: "H1 2026",
            status: "collecting",
            periodStart: "2026-01-01",
            periodEnd: "2026-06-30",
            participantCount: 12,
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: h })).toBeVisible();
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByRole("link", { name: "H1 2026" })).toHaveAttribute(
      "href",
      "/cycles/c1",
    );
    expect(within(row).getByText(st)).toBeVisible();
    expect(within(row).getByText("2026-01-01 → 2026-06-30")).toBeVisible();
    expect(within(row).getByText("12")).toBeVisible();
  });

  it.each([
    ["es", "Todavía no hay ciclos."],
    ["en", "There are no cycles yet."],
  ] as const)("shows the empty state in %s", (locale, empty) => {
    renderIn(locale, <CyclesList cycles={[]} />);
    expect(screen.getByText(empty)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("offers no way to create a cycle (cycles are read-only containers)", () => {
    renderIn("es", <CyclesList cycles={[]} />);
    expect(
      screen.queryByRole("link", { name: "Nuevo ciclo" }),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- detail

const detail: CycleDetailData = {
  id: "c1",
  name: "H1 2026",
  status: "closed",
  periodStart: "2026-01-01",
  periodEnd: "2026-06-30",
  snapshotDate: "2026-06-01",
  questionCount: 5,
  stats: { active: 2, removed: 0, withoutManager: 1 },
  participants: [
    {
      id: "p1",
      displayName: "Ana García",
      snapManagerName: null,
      snapDepartment: "Dirección",
      snapJobTitle: "CEO",
      withoutManager: true,
      removedAt: null,
    },
    {
      id: "p2",
      displayName: "Bruno Pérez",
      snapManagerName: "Carla Romero",
      snapDepartment: "Ingeniería",
      snapJobTitle: "Developer",
      withoutManager: false,
      removedAt: null,
    },
  ],
};

describe("CycleDetailView", () => {
  it.each([
    ["es", "Cerrado", "Sin manager"],
    ["en", "Closed", "No manager"],
  ] as const)(
    "shows status and participants with their snapshot in %s",
    (locale, status, noManager) => {
      renderIn(locale, <CycleDetailView cycle={detail} />);
      expect(
        screen.getByRole("heading", { level: 1, name: "H1 2026" }),
      ).toBeVisible();
      expect(screen.getByText(status)).toBeVisible();
      const [, anaRow, brunoRow] = within(
        screen.getByRole("table"),
      ).getAllByRole("row");
      expect(within(anaRow).getByText(noManager)).toBeVisible();
      expect(within(brunoRow).getByText("Carla Romero")).toBeVisible();
      expect(within(brunoRow).getByText("Ingeniería")).toBeVisible();
    },
  );

  it("is read-only: no phase changes, launch or log", () => {
    renderIn("en", <CycleDetailView cycle={detail} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it.each([
    ["es", "Este ciclo todavía no tiene participantes."],
    ["en", "This cycle has no participants yet."],
  ] as const)("shows a cycle without participants in %s", (locale, e) => {
    renderIn(
      locale,
      <CycleDetailView
        cycle={{
          ...detail,
          participants: [],
          stats: { active: 0, removed: 0, withoutManager: 0 },
        }}
      />,
    );
    expect(screen.getByText(e)).toBeVisible();
  });
});
