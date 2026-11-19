import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { GoalDetail, GoalListPage } from "@/modules/goals/browse";
import { noOrgOptions } from "@/modules/org-attributes/kinds";
import { GoalDetailView } from "./goal-detail-view";
import { GoalsFilters } from "./goals-filters";
import { GoalStateChips, GoalsOverview, GoalsTable } from "./goals-table";

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

const item = (over: Partial<GoalListPage["items"][number]> = {}) => ({
  id: "g1",
  title: "Migrar la API",
  status: "in_progress" as const,
  state: "in_progress" as const,
  percentComplete: 50,
  dueDate: "2026-12-31",
  completionDate: null,
  person: { id: "p1", name: "Dora Díaz" },
  department: "Producto",
  milestonesTotal: 2,
  milestonesDone: 1,
  ...over,
});
const listPage = (items = [item()], over: Partial<GoalListPage> = {}) => ({
  items,
  total: items.length,
  counts: { in_progress: 1, completed: 2, closed: 0, overdue: 1 },
  asOf: "2026-11-18",
  due: { total: 3, completed: 2 },
  page: 1,
  pageSize: 25,
  ...over,
});

describe("GoalsTable", () => {
  it("shows a goal with its owner, state, progress bar, due date and milestones", () => {
    renderIn(
      "es",
      <GoalsTable page={listPage()} showPerson hrefForPage={() => "/goals"} />,
    );
    const row = screen.getByRole("article", { name: /Migrar la API/ });
    expect(
      within(row).getByRole("link", { name: "Migrar la API" }),
    ).toHaveAttribute("href", "/goals/g1");
    expect(within(row).getByText("Dora Díaz")).toBeVisible();
    expect(within(row).getByText("En curso")).toBeVisible();
    expect(within(row).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(within(row).getByText(/31 dic 2026/)).toBeVisible();
    expect(within(row).getByText("1 de 2")).toBeVisible();
  });

  it("labels an overdue goal with the word, not only a color", () => {
    renderIn(
      "en",
      <GoalsTable
        page={listPage([item({ state: "overdue" })])}
        showPerson
        hrefForPage={() => "/goals"}
      />,
    );
    expect(screen.getByText("Overdue")).toBeVisible();
  });

  it("leaves the person column out when every goal is the reader's own", () => {
    renderIn(
      "es",
      <GoalsTable
        page={listPage()}
        showPerson={false}
        hrefForPage={() => "/goals"}
      />,
    );
    expect(
      screen.queryByRole("columnheader", { name: "Persona" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Dora Díaz")).not.toBeInTheDocument();
  });

  it("says when nothing matches, and shows dashes for no due date or milestones", () => {
    const { unmount } = renderIn(
      "es",
      <GoalsTable
        page={listPage([], { total: 0 })}
        showPerson
        hrefForPage={() => "/goals"}
      />,
    );
    expect(
      screen.getByText("No hay objetivos con estos filtros."),
    ).toBeVisible();
    unmount();
    renderIn(
      "es",
      <GoalsTable
        page={listPage([
          item({ dueDate: null, milestonesTotal: 0, milestonesDone: 0 }),
        ])}
        showPerson
        hrefForPage={() => "/goals"}
      />,
    );
    expect(screen.getByText("Sin fecha")).toBeVisible();
    expect(screen.getByText("–")).toBeVisible();
  });

  it("pages with previous and next links", () => {
    renderIn(
      "es",
      <GoalsTable
        page={listPage([item()], { total: 60, page: 2 })}
        showPerson
        hrefForPage={(n) => `/goals?page=${n}`}
      />,
    );
    expect(screen.getByRole("link", { name: "Anterior" })).toHaveAttribute(
      "href",
      "/goals?page=1",
    );
    expect(screen.getByRole("link", { name: "Siguiente" })).toHaveAttribute(
      "href",
      "/goals?page=3",
    );
    expect(screen.getByText("Página 2 de 3")).toBeVisible();
  });
});

describe("GoalStateChips", () => {
  it("counts each state and marks the chosen one", () => {
    renderIn(
      "es",
      <GoalStateChips
        counts={{ in_progress: 1, completed: 2, closed: 0, overdue: 1 }}
        current="overdue"
        hrefFor={(s) => `/goals?state=${s ?? ""}`}
      />,
    );
    const group = screen.getByRole("group", { name: "Objetivos por estado" });
    expect(
      within(group).getByRole("link", { name: "Todos 4" }),
    ).toHaveAttribute("href", "/goals?state=");
    const overdue = within(group).getByRole("link", { name: "Vencido 1" });
    expect(overdue).toHaveAttribute("aria-current", "true");
    expect(overdue).toHaveAttribute("href", "/goals?state=overdue");
    expect(
      within(group).getByRole("link", { name: "Completado 2" }),
    ).not.toHaveAttribute("aria-current");
  });
});

describe("GoalsFilters", () => {
  const options = {
    departments: ["Producto"],
    org: { ...noOrgOptions, dms: ["Dana"] },
  };
  const cycles = [{ id: "c1", name: "Primer semestre" }];

  it("preserves the selected state while cycle, person and advanced org filters submit", () => {
    renderIn(
      "es",
      <GoalsFilters
        params={{ page: 1, state: "overdue" }}
        cycleId="c1"
        cycles={cycles}
        options={options}
        ownOnly={false}
      />,
    );
    const form = screen.getByRole("form", { name: "Filtros de objetivos" });
    expect(form).toHaveAttribute("method", "get");
    expect(new FormData(form as HTMLFormElement).get("state")).toBe("overdue");
    expect(within(form).getByLabelText("DM")).not.toBeVisible();
    fireEvent.click(screen.getByText("Más filtros"));
    expect(within(form).getByLabelText("Buscar")).toBeVisible();
    expect(within(form).getByLabelText("Ciclo")).toHaveValue("c1");
    for (const label of ["Ciclo", "Área", "DM"]) {
      expect(within(form).getByLabelText(label)).toBeVisible();
    }
    expect(within(form).getByRole("button", { name: "Aplicar" })).toBeVisible();
  });

  it("offers only cycle, state and a title search to someone who sees only their own goals", () => {
    renderIn(
      "es",
      <GoalsFilters
        params={{ page: 1 }}
        cycleId={undefined}
        cycles={cycles}
        options={options}
        ownOnly
      />,
    );
    expect(screen.getByLabelText("Ciclo")).toBeVisible();
    expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ciclo")).toHaveValue("all");
    expect(screen.getByPlaceholderText("Título del objetivo")).toBeVisible();
    expect(screen.queryByLabelText("DM")).not.toBeInTheDocument();
  });
});

const goal = (over: Partial<GoalDetail> = {}): GoalDetail => ({
  id: "g1",
  title: "Migrar la API",
  description: "Pasar todo a la v2",
  status: "in_progress",
  state: "in_progress",
  percentComplete: 50,
  createdAt: "2026-03-01T12:00:00.000Z",
  dueDate: "2026-12-31",
  completionDate: null,
  lastChangedAt: "2026-09-02T12:00:00.000Z",
  person: { id: "p1", name: "Dora Díaz" },
  department: "Producto",
  milestones: [
    {
      id: "m1",
      title: "Endpoints",
      position: 0,
      completedAt: "2026-08-01T12:00:00.000Z",
    },
    { id: "m2", title: "Datos", position: 1, completedAt: null },
  ],
  comments: [
    {
      id: "c1",
      author: "Bruno Gil",
      text: "Va bien",
      postedAt: "2026-09-01T12:00:00.000Z",
    },
    { id: "c2", author: null, text: "Sin autor", postedAt: null },
  ],
  appearances: [
    {
      cycleId: "cy1",
      cycleName: "Primer semestre",
      localizedName: null,
      periodEnd: "2026-06-30",
      participantId: "pa1",
      revieweePersonId: "p1",
      snapManagerPersonId: "m",
    },
    {
      cycleId: "cy2",
      cycleName: "Segundo semestre",
      localizedName: null,
      periodEnd: "2026-12-31",
      participantId: "pa2",
      revieweePersonId: "p1",
      snapManagerPersonId: "m",
    },
  ],
  ...over,
});

describe("GoalDetailView", () => {
  it("shows the summary: owner, state, progress and the three dates", () => {
    renderIn(
      "es",
      <GoalDetailView goal={goal()} openableParticipants={new Set()} />,
    );
    const summary = screen.getByTestId("goal-summary");
    expect(within(summary).getByText("Dora Díaz")).toBeVisible();
    expect(within(summary).getByText("En curso")).toBeVisible();
    expect(within(summary).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(within(summary).getByText(/1 mar 2026/)).toBeVisible();
    expect(within(summary).getByText(/31 dic 2026/)).toBeVisible();
    // Not finished yet.
    expect(within(summary).getAllByText("Sin fecha")).toHaveLength(1);
    expect(screen.getByText("Pasar todo a la v2")).toBeVisible();
  });

  it("lists the milestones with how many are done, and the comments", () => {
    renderIn(
      "es",
      <GoalDetailView goal={goal()} openableParticipants={new Set()} />,
    );
    const milestones = screen.getByTestId("goal-milestones");
    expect(within(milestones).getByText("1 de 2 completados")).toBeVisible();
    expect(within(milestones).getByText("Endpoints")).toBeVisible();
    expect(
      within(milestones).getByText(/Completado el 1 ago 2026/),
    ).toBeVisible();
    expect(within(milestones).getByText("Pendiente")).toBeVisible();
    const comments = screen.getByTestId("goal-comments");
    expect(within(comments).getByText("Va bien")).toBeVisible();
    expect(within(comments).getByText("Autor desconocido")).toBeVisible();
  });

  it("says so when a goal has no description, milestones or comments", () => {
    renderIn(
      "en",
      <GoalDetailView
        goal={goal({
          description: null,
          milestones: [],
          comments: [],
          appearances: [],
        })}
        openableParticipants={new Set()}
      />,
    );
    expect(screen.getByText("This goal has no description.")).toBeVisible();
    expect(screen.getByText("This goal has no milestones.")).toBeVisible();
    expect(screen.getByText("No comments yet.")).toBeVisible();
    expect(
      screen.getByText("It does not appear in any assessment yet."),
    ).toBeVisible();
  });

  it("links to the assessments of the cycles it is part of, only those the reader may open", () => {
    renderIn(
      "es",
      <GoalDetailView goal={goal()} openableParticipants={new Set(["pa1"])} />,
    );
    const panel = screen.getByTestId("goal-assessments");
    expect(
      within(panel).getByRole("link", {
        name: "Ver el assessment de Primer semestre",
      }),
    ).toHaveAttribute("href", "/assessments/cy1/pa1");
    expect(within(panel).getByText("Segundo semestre")).toBeVisible();
    expect(
      within(panel).queryByRole("link", { name: /Segundo semestre/ }),
    ).not.toBeInTheDocument();
  });
});

describe("GoalsOverview", () => {
  it("links each KPI to the list filtered by its state, with the overdue tone", () => {
    renderIn(
      "es",
      <GoalsOverview
        counts={{ in_progress: 50, completed: 30, closed: 0, overdue: 20 }}
        thresholds={{ goodPct: 80, watchPct: 60 }}
        hrefFor={(state) => `/goals?state=${state}`}
      />,
    );
    expect(screen.getByRole("link", { name: "20" })).toHaveAttribute(
      "href",
      "/goals?state=overdue",
    );
    expect(screen.getByRole("link", { name: "50" })).toHaveAttribute(
      "href",
      "/goals?state=in_progress",
    );
    expect(
      screen.getByRole("link", { name: "Objetivos completados" }),
    ).toHaveAttribute("href", "/goals?state=completed");
    // 20 % overdue: 80 % on time, at the good threshold.
    expect(screen.getByText("En meta")).toBeInTheDocument();
  });
});
