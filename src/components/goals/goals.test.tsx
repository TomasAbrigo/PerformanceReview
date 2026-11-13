import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { GoalView, TeamGoalsData } from "@/modules/goals";
import { GoalsSection } from "./goals-section";
import { ManagerPicker } from "./manager-picker";
import { TeamGoals } from "./team-goals";

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

function goal(overrides: Partial<GoalView> = {}): GoalView {
  return {
    id: "g1",
    title: "Reducir el tiempo de respuesta",
    description: "Bajar la mediana a menos de 4 horas.",
    percentComplete: 55,
    status: "in_progress",
    dueDate: "2026-12-31",
    completionDate: null,
    commentCount: 1,
    milestones: [
      { id: "m1", title: "Medir la línea de base", completedAt: new Date() },
      { id: "m2", title: "Cubrir el turno noche", completedAt: null },
    ],
    sharedWith: [],
    ...overrides,
  };
}

const closed = goal({
  id: "g2",
  title: "Migrar legajos",
  status: "closed",
  percentComplete: 60,
  dueDate: "2026-06-30",
  commentCount: 0,
  milestones: [],
});
const completed = goal({
  id: "g3",
  title: "Obtener la certificación",
  status: "completed",
  percentComplete: 100,
  dueDate: "2026-09-30",
  completionDate: "2026-09-20",
  commentCount: 3,
  milestones: [],
});

describe("GoalsSection", () => {
  it.each([
    ["es", "Objetivos", "En curso", "Completado", "Cerrado"],
    ["en", "Goals", "In progress", "Completed", "Closed"],
  ] as const)(
    "lists the goals in the given order with status badges in %s",
    (locale, heading, inProgress, done, closedLabel) => {
      renderIn(locale, <GoalsSection goals={[closed, completed, goal()]} />);

      expect(
        screen.getByRole("heading", { level: 2, name: heading }),
      ).toBeInTheDocument();
      const cards = screen.getAllByRole("article");
      expect(
        cards.map((c) => within(c).getByRole("heading").textContent),
      ).toEqual([
        "Migrar legajos",
        "Obtener la certificación",
        "Reducir el tiempo de respuesta",
      ]);
      expect(within(cards[0]).getByText(closedLabel)).toBeInTheDocument();
      expect(within(cards[1]).getByText(done)).toBeInTheDocument();
      expect(within(cards[2]).getByText(inProgress)).toBeInTheDocument();
    },
  );

  it.each([
    ["es", "Progreso", "55%"],
    ["en", "Progress", "55%"],
  ] as const)(
    "shows progress as an accessible bar in %s",
    (locale, label, text) => {
      renderIn(locale, <GoalsSection goals={[goal()]} />);

      const bar = screen.getByRole("progressbar", { name: label });
      expect(bar).toHaveAttribute("aria-valuenow", "55");
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
      expect(screen.getByText(text)).toBeInTheDocument();
    },
  );

  it.each([
    ["es", "Hitos", "1 de 2 hitos", "Hecho", "Pendiente"],
    ["en", "Milestones", "1 of 2 milestones", "Done", "Pending"],
  ] as const)(
    "shows the milestones checklist in %s",
    (locale, label, summary, done, pending) => {
      renderIn(locale, <GoalsSection goals={[goal()]} />);

      const list = screen.getByRole("list", { name: label });
      const items = within(list).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("Medir la línea de base");
      expect(within(items[0]).getByText(done)).toBeInTheDocument();
      expect(items[1]).toHaveTextContent("Cubrir el turno noche");
      expect(within(items[1]).getByText(pending)).toBeInTheDocument();
      expect(screen.getByText(summary)).toBeInTheDocument();
    },
  );

  it("omits the milestones list for a goal without milestones", () => {
    renderIn("es", <GoalsSection goals={[closed]} />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it.each([
    ["es", ["Sin comentarios", "1 comentario", "3 comentarios"]],
    ["en", ["No comments", "1 comment", "3 comments"]],
  ] as const)("shows the comment count in %s", (locale, [none, one, many]) => {
    renderIn(locale, <GoalsSection goals={[closed, goal(), completed]} />);

    expect(screen.getByText(none)).toBeInTheDocument();
    expect(screen.getByText(one)).toBeInTheDocument();
    expect(screen.getByText(many)).toBeInTheDocument();
  });

  it.each([
    [
      "es",
      "Vence 31 dic 2026",
      "Completado el 20 sept 2026",
      "Sin fecha límite",
    ],
    ["en", "Due Dec 31, 2026", "Completed on Sep 20, 2026", "No due date"],
  ] as const)("formats the dates for %s", (locale, due, completedOn, noDue) => {
    renderIn(
      locale,
      <GoalsSection
        goals={[goal(), completed, goal({ id: "g9", dueDate: null })]}
      />,
    );

    expect(screen.getByText(due)).toBeInTheDocument();
    expect(screen.getByText(completedOn)).toBeInTheDocument();
    expect(screen.getByText(noDue)).toBeInTheDocument();
  });

  it.each([
    ["es", "Compartido con Bruno Pérez, Carla Romero"],
    ["en", "Shared with Bruno Pérez, Carla Romero"],
  ] as const)("names who a goal is shared with in %s", (locale, text) => {
    renderIn(
      locale,
      <GoalsSection
        goals={[
          goal({
            sharedWith: [
              { personId: "p2", displayName: "Bruno Pérez" },
              { personId: "p3", displayName: "Carla Romero" },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it.each([
    ["es", "Todavía no hay objetivos importados."],
    ["en", "No goals imported yet."],
  ] as const)("shows the empty state in %s", (locale, empty) => {
    renderIn(locale, <GoalsSection goals={[]} />);

    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});

const team: TeamGoalsData = {
  manager: { id: "m1", displayName: "Ana García" },
  reports: [
    {
      person: { id: "p2", displayName: "Bruno Pérez" },
      goals: [completed, goal()],
    },
    { person: { id: "p4", displayName: "Diego Sosa" }, goals: [] },
  ],
};

describe("TeamGoals", () => {
  it.each([
    [
      "es",
      "Objetivos del equipo",
      "Objetivos de los reportes directos de Ana García.",
    ],
    ["en", "Team goals", "Goals of Ana García's direct reports."],
  ] as const)(
    "groups goals by direct report in %s",
    (locale, title, description) => {
      renderIn(locale, <TeamGoals team={team} />);

      expect(
        screen.getByRole("heading", { level: 1, name: title }),
      ).toBeInTheDocument();
      expect(screen.getByText(description)).toBeInTheDocument();

      const groups = screen.getAllByRole("region");
      expect(groups).toHaveLength(2);
      const bruno = within(groups[0]);
      expect(bruno.getByRole("link", { name: "Bruno Pérez" })).toHaveAttribute(
        "href",
        "/people/p2",
      );
      expect(
        bruno
          .getAllByRole("article")
          .map((c) => within(c).getByRole("heading").textContent),
      ).toEqual(["Obtener la certificación", "Reducir el tiempo de respuesta"]);
      expect(
        within(groups[1]).getByRole("link", { name: "Diego Sosa" }),
      ).toBeInTheDocument();
    },
  );

  it.each([
    ["es", "2 objetivos", "Sin objetivos."],
    ["en", "2 goals", "No goals."],
  ] as const)(
    "summarizes each report and flags the ones with no goals in %s",
    (locale, summary, none) => {
      renderIn(locale, <TeamGoals team={team} />);

      const [bruno, diego] = screen.getAllByRole("region");
      expect(within(bruno).getByText(summary)).toBeInTheDocument();
      expect(within(diego).getByText(none)).toBeInTheDocument();
    },
  );

  it.each([
    ["es", "Ana García no tiene reportes directos."],
    ["en", "Ana García has no direct reports."],
  ] as const)("shows an empty state without reports in %s", (locale, text) => {
    renderIn(locale, <TeamGoals team={{ ...team, reports: [] }} />);

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

describe("ManagerPicker", () => {
  const managers = [
    { id: "m1", displayName: "Ana García" },
    { id: "m2", displayName: "Bruno Pérez" },
  ];

  it.each([
    ["es", "Elegí un manager para ver los objetivos de su equipo."],
    ["en", "Choose a manager to see their team's goals."],
  ] as const)("links each manager to their team in %s", (locale, prompt) => {
    renderIn(locale, <ManagerPicker managers={managers} />);

    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ana García" })).toHaveAttribute(
      "href",
      "/team/goals?manager=m1",
    );
    expect(screen.getByRole("link", { name: "Bruno Pérez" })).toHaveAttribute(
      "href",
      "/team/goals?manager=m2",
    );
  });

  it.each([
    ["es", "No hay managers con reportes directos."],
    ["en", "No managers with direct reports."],
  ] as const)("shows an empty state in %s", (locale, text) => {
    renderIn(locale, <ManagerPicker managers={[]} />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
