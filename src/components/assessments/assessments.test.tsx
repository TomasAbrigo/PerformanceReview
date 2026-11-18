import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type {
  AssessmentDetail,
  AssessmentListPage,
  AssessmentQuestion,
  AssessmentSide,
} from "@/modules/assessments";
import { AssessmentView } from "./assessment-view";
import { AssessmentsFilters } from "./assessments-filters";
import {
  ParticipantsTable,
  ProgressChips,
  ProgressOverview,
} from "./participants-table";
import { noOrgOptions } from "@/modules/org-attributes/kinds";

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

// ------------------------------------------------------------------- list

const row = (
  over: Partial<AssessmentListPage["items"][number]> = {},
): AssessmentListPage["items"][number] => ({
  participantId: "pa1",
  person: { id: "p1", name: "Dora Díaz" },
  manager: { id: "m1", name: "Bruno Gil" },
  department: "Producto",
  jobTitle: "Designer",
  self: { state: "submitted", submittedAt: "2026-06-10T12:00:00.000Z" },
  managerReview: { state: "locked", submittedAt: null },
  progress: "partial",
  ...over,
});
const listPage = (
  items = [row()],
  over: Partial<AssessmentListPage> = {},
): AssessmentListPage => ({
  items,
  total: items.length,
  counts: { complete: 3, partial: 1, pending: 2 },
  page: 1,
  pageSize: 25,
  ...over,
});

describe("ParticipantsTable", () => {
  it("shows each participant with their manager, area and where each side stands", () => {
    renderIn(
      "es",
      <ParticipantsTable
        cycleId="c1"
        page={listPage()}
        showPeople
        hrefForPage={() => "/assessments"}
      />,
    );
    const r = screen.getByRole("article", { name: /Dora Díaz/ });
    expect(within(r).getByRole("link", { name: "Dora Díaz" })).toHaveAttribute(
      "href",
      "/assessments/c1/pa1",
    );
    expect(within(r).getByText(/Bruno Gil/)).toBeVisible();
    expect(within(r).getByText(/Producto/)).toBeVisible();
    expect(within(r).getByText("Enviada")).toBeVisible();
    // A side the reader may not read yet is said so, never its status.
    expect(within(r).getByText("Reservada")).toBeVisible();
    expect(within(r).getByText("Parcial")).toBeVisible();
  });

  it("hides manager and area when every row is the reader", () => {
    renderIn(
      "es",
      <ParticipantsTable
        cycleId="c1"
        page={listPage()}
        showPeople={false}
        hrefForPage={() => "/assessments"}
      />,
    );
    expect(
      screen.queryByRole("columnheader", { name: "Manager" }),
    ).not.toBeInTheDocument();
  });

  it("says when nothing matches", () => {
    renderIn(
      "en",
      <ParticipantsTable
        cycleId="c1"
        page={listPage([], { total: 0 })}
        showPeople
        hrefForPage={() => "/assessments"}
      />,
    );
    expect(
      screen.getByText("No participants match these filters."),
    ).toBeVisible();
  });
});

describe("ProgressChips", () => {
  it("counts each progress and marks the chosen one", () => {
    renderIn(
      "es",
      <ProgressChips
        counts={{ complete: 3, partial: 1, pending: 2 }}
        current="partial"
        hrefFor={(p) => `/assessments?progress=${p ?? ""}`}
      />,
    );
    const group = screen.getByRole("group", {
      name: "Estado de los assessments",
    });
    expect(within(group).getByRole("link", { name: "Todos 6" })).toBeVisible();
    expect(
      within(group).getByRole("link", { name: "Parcial 1" }),
    ).toHaveAttribute("aria-current", "true");
  });
});

describe("AssessmentsFilters", () => {
  const options = {
    departments: ["Producto"],
    org: { ...noOrgOptions, dms: ["Dana"] },
  };
  const cycles = [
    { id: "c2", name: "Segundo semestre" },
    { id: "c1", name: "Primer semestre" },
  ];

  it("offers cycle, status, person, area and the org cuts", () => {
    renderIn(
      "es",
      <AssessmentsFilters
        params={{ page: 1 }}
        cycleId="c2"
        cycles={cycles}
        options={options}
        ownOnly={false}
      />,
    );
    const form = screen.getByRole("form", { name: "Filtros de assessments" });
    expect(within(form).getByLabelText("Ciclo")).toHaveValue("c2");
    fireEvent.click(screen.getByText("Más filtros"));
    for (const label of ["Persona", "Área", "DM"]) {
      expect(within(form).getByLabelText(label)).toBeVisible();
    }
  });

  it("offers only the cycle to someone who sees only their own", () => {
    renderIn(
      "es",
      <AssessmentsFilters
        params={{ page: 1 }}
        cycleId="c2"
        cycles={cycles}
        options={options}
        ownOnly
      />,
    );
    expect(screen.getByLabelText("Ciclo")).toBeVisible();
    expect(screen.queryByLabelText("Persona")).not.toBeInTheDocument();
  });
});

// ----------------------------------------------------------------- detail

const scale = {
  options: [
    { value: 1, label: { es: "Bajo", en: "Low" }, normalized: 0 },
    { value: 4, label: { es: "Alto", en: "High" }, normalized: 1 },
  ],
};
const question = (
  over: Partial<AssessmentQuestion> = {},
): AssessmentQuestion => ({
  id: "q1",
  prompt: { es: "¿Qué hago bien?", en: "What do I do well?" },
  kind: "text",
  role: null,
  scale: null,
  choices: null,
  visibleToReviewee: true,
  required: false,
  custom: false,
  answer: {
    optionValue: null,
    optionLabel: null,
    textValue: "Soy ordenada",
    updatedAt: "2026-06-10T12:00:00.000Z",
  },
  ...over,
});
const side = (over: Partial<AssessmentSide> = {}): AssessmentSide => ({
  relationship: "self",
  state: "submitted",
  author: { id: "p1", name: "Dora Díaz" },
  submittedAt: "2026-06-10T12:00:00.000Z",
  sharedAt: null,
  sections: [
    {
      title: { es: "Autoevaluación", en: "Self assessment" },
      questions: [question()],
    },
  ],
  ...over,
});
const detail = (over: Partial<AssessmentDetail> = {}): AssessmentDetail => ({
  cycle: {
    id: "c1",
    name: "Primer semestre",
    localizedName: null,
    periodStart: "2026-01-01",
    periodEnd: "2026-06-30",
  },
  participant: {
    id: "pa1",
    person: { id: "p1", name: "Dora Díaz" },
    manager: { id: "m1", name: "Bruno Gil" },
    department: "Producto",
    jobTitle: "Designer",
    location: null,
    snapshotAsOf: "2026-06-01",
    removed: false,
  },
  employeeView: false,
  sides: [
    side(),
    side({
      relationship: "manager",
      author: { id: "m1", name: "Bruno Gil" },
      sharedAt: "2026-07-01T12:00:00.000Z",
      sections: [
        {
          title: { es: "Evaluación del manager", en: "Manager assessment" },
          questions: [
            question({
              id: "q2",
              prompt: { es: "Retención", en: "Retention" },
              kind: "single_choice",
              role: "retention",
              visibleToReviewee: false,
              choices: [
                {
                  value: "A",
                  label: {
                    es: "Me convencería de quedarme",
                    en: "I would convince them",
                  },
                },
              ],
              answer: {
                optionValue: 4,
                optionLabel: "A",
                textValue: null,
                updatedAt: "2026-06-12T12:00:00.000Z",
              },
            }),
            question({
              id: "q3",
              prompt: { es: "Valoración", en: "Rating" },
              kind: "rating",
              scale,
              answer: {
                optionValue: 4,
                optionLabel: "Alto",
                textValue: null,
                updatedAt: "2026-06-12T12:00:00.000Z",
              },
            }),
            question({
              id: "q4",
              prompt: { es: "Pregunta propia", en: "Own question" },
              custom: true,
              answer: null,
            }),
          ],
        },
      ],
    }),
  ],
  goals: [
    {
      id: "s1",
      goalId: "g1",
      openable: true,
      title: "Migrar la API",
      status: "in_progress",
      percentComplete: 10,
      dueDate: "2026-12-31",
      noLongerApplicable: false,
    },
    {
      id: "s2",
      goalId: "g2",
      openable: false,
      title: "Documentar",
      status: "completed",
      percentComplete: 100,
      dueDate: null,
      noLongerApplicable: false,
    },
    {
      id: "s3",
      goalId: null,
      openable: false,
      title: "Meta borrada",
      status: "closed",
      percentComplete: 0,
      dueDate: null,
      noLongerApplicable: true,
    },
  ],
  goalsAsOf: "2026-06-02T12:00:00.000Z",
  ...over,
});
const toggle = {
  full: "/assessments/c1/pa1",
  employee: "/assessments/c1/pa1?view=employee",
};

describe("AssessmentView", () => {
  it("shows the self-assessment and the manager review side by side, each question with its answer", () => {
    renderIn(
      "es",
      <AssessmentView
        detail={detail()}
        cycleName="Primer semestre"
        toggle={toggle}
      />,
    );
    const self = screen.getByTestId("assessment-self");
    const manager = screen.getByTestId("assessment-manager");
    expect(
      within(self).getByRole("heading", { name: "Autoevaluación" }),
    ).toBeVisible();
    expect(
      within(manager).getByRole("heading", { name: "Evaluación del manager" }),
    ).toBeVisible();
    expect(within(self).getByText("¿Qué hago bien?")).toBeVisible();
    expect(within(self).getByText("Soy ordenada")).toBeVisible();
    expect(within(self).getByText("Escribe: Dora Díaz")).toBeVisible();
    expect(within(self).getByText(/Enviada el 10 jun 2026/)).toBeVisible();
    expect(
      within(manager).getByText(/Compartida con la persona el 1 jul 2026/),
    ).toBeVisible();
  });

  it("shows a closed answer as its value on the scale and the option's label", () => {
    renderIn(
      "es",
      <AssessmentView
        detail={detail()}
        cycleName="Primer semestre"
        toggle={toggle}
      />,
    );
    const manager = screen.getByTestId("assessment-manager");
    const retention = within(manager).getAllByTestId("question")[0];
    expect(within(retention).getByLabelText("4 de 5")).toHaveTextContent("4/5");
    expect(within(retention).getByText("A")).toBeVisible();
    expect(
      within(retention).getByText("Me convencería de quedarme"),
    ).toBeVisible();
    const rating = within(manager).getAllByTestId("question")[1];
    expect(within(rating).getByLabelText("4 de 4")).toBeVisible();
    expect(within(rating).getByText("Alto")).toBeVisible();
  });

  it("marks the custom questions, the unanswered ones and the ones hidden from the employee", () => {
    renderIn(
      "es",
      <AssessmentView
        detail={detail()}
        cycleName="Primer semestre"
        toggle={toggle}
      />,
    );
    const manager = screen.getByTestId("assessment-manager");
    const [retention, , custom] = within(manager).getAllByTestId("question");
    expect(within(retention).getByText("Oculta al empleado")).toBeVisible();
    expect(
      within(custom).getByText("Pregunta propia", { selector: ".kicker" }),
    ).toBeVisible();
    expect(within(custom).getByText("Sin respuesta")).toBeVisible();
  });

  it("shows the goals of the period, linking only the ones the reader may open", () => {
    renderIn(
      "es",
      <AssessmentView
        detail={detail()}
        cycleName="Primer semestre"
        toggle={toggle}
      />,
    );
    const goals = screen.getByTestId("assessment-goals");
    expect(
      within(goals).getByText(
        /Los goals de Dora Díaz cuando se armó el ciclo \(2 jun 2026\)/,
      ),
    ).toBeVisible();
    expect(
      within(goals).getByRole("link", { name: "Migrar la API" }),
    ).toHaveAttribute("href", "/goals/g1");
    expect(
      within(goals).queryByRole("link", { name: "Documentar" }),
    ).not.toBeInTheDocument();
    expect(within(goals).getByText("Documentar")).toBeVisible();
    expect(within(goals).getByText("Ya no aplica")).toBeVisible();
    expect(within(goals).getAllByRole("progressbar")).toHaveLength(3);
    expect(
      within(goals).getByRole("progressbar", { name: "10% completado" }),
    ).toBeVisible();
  });

  it("says there were no goals when the snapshot is empty", () => {
    renderIn(
      "es",
      <AssessmentView
        detail={detail({ goals: [], goalsAsOf: null })}
        cycleName="Primer semestre"
        toggle={toggle}
      />,
    );
    expect(screen.getByText("No tenía goals en este período.")).toBeVisible();
  });

  it("explains a side that is not for the reader yet, without any question", () => {
    renderIn(
      "es",
      <AssessmentView
        detail={detail({
          sides: [
            side(),
            side({
              relationship: "manager",
              state: "locked",
              author: null,
              sections: [],
            }),
          ],
        })}
        cycleName="Primer semestre"
        toggle={toggle}
      />,
    );
    const manager = screen.getByTestId("assessment-manager");
    expect(
      within(manager).getByText(/Todavía no está disponible para vos/),
    ).toBeVisible();
    expect(within(manager).queryByTestId("question")).not.toBeInTheDocument();
  });

  it("says when a side was not requested", () => {
    renderIn(
      "en",
      <AssessmentView
        detail={detail({
          sides: [
            side(),
            side({
              relationship: "manager",
              state: "none",
              author: null,
              sections: [],
            }),
          ],
        })}
        cycleName="First semester"
        toggle={toggle}
      />,
    );
    expect(
      within(screen.getByTestId("assessment-manager")).getByText(
        "This review was not requested.",
      ),
    ).toBeVisible();
  });

  it("offers the employee view to someone who is not the employee, and says what it shows", () => {
    const { unmount } = renderIn(
      "es",
      <AssessmentView
        detail={detail()}
        cycleName="Primer semestre"
        toggle={toggle}
      />,
    );
    const group = screen.getByRole("group", { name: "Vista" });
    expect(
      within(group).getByRole("link", { name: "Completa" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(group).getByRole("link", { name: "Vista de empleado" }),
    ).toHaveAttribute("href", "/assessments/c1/pa1?view=employee");
    unmount();
    renderIn(
      "es",
      <AssessmentView
        detail={detail({ employeeView: true })}
        cycleName="Primer semestre"
        toggle={toggle}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Vista de empleado" }),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getByText(/Así lo lee Dora Díaz/)).toBeVisible();
  });

  it("offers no toggle to the employee themself", () => {
    renderIn(
      "es",
      <AssessmentView detail={detail()} cycleName="Primer semestre" />,
    );
    expect(
      screen.queryByRole("group", { name: "Vista" }),
    ).not.toBeInTheDocument();
  });

  it("tags a question hidden from the employee by the question itself, with or without the toggle", () => {
    const { unmount } = renderIn(
      "es",
      <AssessmentView
        detail={detail()}
        cycleName="Primer semestre"
        toggle={toggle}
      />,
    );
    expect(screen.getAllByText("Oculta al empleado")).toHaveLength(1);
    unmount();
    renderIn(
      "es",
      <AssessmentView detail={detail()} cycleName="Primer semestre" />,
    );
    expect(screen.getAllByText("Oculta al empleado")).toHaveLength(1);
  });

  it("reads in English", () => {
    renderIn(
      "en",
      <AssessmentView
        detail={detail()}
        cycleName="First semester"
        toggle={toggle}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Self-assessment" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Manager review" }),
    ).toBeVisible();
    expect(screen.getByText("I would convince them")).toBeVisible();
    expect(screen.getByRole("link", { name: "Employee view" })).toBeVisible();
  });
});

describe("ProgressOverview", () => {
  it("shows the complete share with its tone and links partial and pending to the filtered list", () => {
    renderIn(
      "es",
      <ProgressOverview
        cycleName="2026-H1"
        counts={{ complete: 50, partial: 20, pending: 30 }}
        thresholds={{ goodPct: 80, watchPct: 60 }}
        hrefFor={(p) => `/assessments?progress=${p}`}
      />,
    );
    expect(screen.getByText("Atrasado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "30" })).toHaveAttribute(
      "href",
      "/assessments?progress=pending",
    );
    expect(screen.getByRole("link", { name: "20" })).toHaveAttribute(
      "href",
      "/assessments?progress=partial",
    );
  });
});
