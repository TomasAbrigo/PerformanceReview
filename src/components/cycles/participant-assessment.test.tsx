import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewData } from "@/components/review/read-only-answers";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  ParticipantAssessmentView,
  type ParticipantAssessmentData,
} from "./participant-assessment";
import { PeriodGoalsBlock, type PeriodGoalView } from "./period-goals-block";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
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

const goal = (over: Partial<PeriodGoalView> = {}): PeriodGoalView => ({
  id: "g1",
  title: "Migrar el módulo de pagos",
  status: "in_progress",
  percentComplete: 60,
  dueDate: "2024-09-30",
  overdue: false,
  noLongerApplicable: false,
  ...over,
});

describe("PeriodGoalsBlock", () => {
  it.each(locales)(
    "lists the goals with status, progress and due date in %s",
    (locale) => {
      renderIn(
        locale,
        <PeriodGoalsBlock
          asOf={new Date("2025-01-15T12:00:00Z")}
          goals={[
            goal(),
            goal({
              id: "g2",
              title: "Documentar la API",
              status: "completed",
              percentComplete: 100,
              dueDate: "2024-03-31",
            }),
          ]}
        />,
      );
      const block = screen.getByTestId("period-goals");
      const migrate = within(block).getByRole("article", {
        name: "Migrar el módulo de pagos",
      });
      expect(migrate).toHaveTextContent(
        locale === "es" ? "En curso" : "In progress",
      );
      expect(
        within(migrate).getByRole("progressbar", {
          name: locale === "es" ? "Progreso" : "Progress",
        }),
      ).toHaveAttribute("aria-valuenow", "60");
      expect(migrate).toHaveTextContent(
        locale === "es" ? "Vence 30 sept 2024" : "Due Sep 30, 2024",
      );
      expect(
        within(block).getByRole("article", { name: "Documentar la API" }),
      ).toHaveTextContent(locale === "es" ? "Completado" : "Completed");
      expect(block).toHaveTextContent(
        locale === "es"
          ? "1 de 2 objetivos completados"
          : "1 of 2 goals completed",
      );
      expect(block).toHaveTextContent(
        locale === "es" ? "Estado al 15 ene 2025" : "Status as of Jan 15, 2025",
      );
    },
  );

  it("flags the overdue goals and the ones that no longer apply, in words", () => {
    renderIn(
      "es",
      <PeriodGoalsBlock
        asOf={new Date("2025-01-15T12:00:00Z")}
        goals={[
          goal({ id: "g1", title: "Atrasado", overdue: true }),
          goal({ id: "g2", title: "Borrado", noLongerApplicable: true }),
          goal({ id: "g3", title: "Sin fecha", dueDate: null }),
        ]}
      />,
    );
    expect(screen.getByRole("article", { name: "Atrasado" })).toHaveTextContent(
      "Vencido",
    );
    expect(screen.getByRole("article", { name: "Borrado" })).toHaveTextContent(
      "Ya no aplica",
    );
    expect(
      screen.getByRole("article", { name: "Sin fecha" }),
    ).toHaveTextContent("Sin fecha límite");
    // The deleted goal is not one of the goals of the summary.
    expect(screen.getByTestId("period-goals")).toHaveTextContent(
      "0 de 2 objetivos completados",
    );
  });

  it.each(locales)(
    "says so when the person had no goals in the period in %s",
    (locale) => {
      renderIn(locale, <PeriodGoalsBlock goals={[]} asOf={null} />);
      expect(
        screen.getByText(
          locale === "es"
            ? "No hay objetivos en este período."
            : "There are no goals in this period.",
        ),
      ).toBeInTheDocument();
    },
  );
});

const review = (over: Partial<ReviewData> = {}): ReviewData => ({
  requestId: "r1",
  cycleName: "H1 2024",
  dueDate: null,
  status: "submitted",
  submittedAt: new Date("2024-07-10T12:00:00Z"),
  questions: [
    {
      id: "q-ret",
      sectionTitle: { es: "Evaluación", en: "Assessment" },
      prompt: { es: "Retención", en: "Retention" },
      kind: "rating",
      required: true,
      scale: {
        options: [
          {
            value: 2,
            label: { es: "Probablemente se vaya", en: "Likely to leave" },
            normalized: 0.25,
          },
          {
            value: 4,
            label: { es: "Probablemente se quede", en: "Likely to stay" },
            normalized: 0.75,
          },
        ],
      },
      choices: null,
    },
    {
      id: "q-text",
      sectionTitle: { es: "Comentarios", en: "Comments" },
      prompt: { es: "Fortalezas", en: "Strengths" },
      kind: "text",
      required: false,
      scale: null,
      choices: null,
    },
  ],
  answers: { "q-ret": 2, "q-text": "Lidera bien al equipo" },
  ...over,
});

const data = (
  over: Partial<ParticipantAssessmentData> = {},
): ParticipantAssessmentData => ({
  cycle: {
    id: "c1",
    name: "H1 2024",
    periodStart: "2024-01-01",
    periodEnd: "2024-06-30",
  },
  participant: {
    id: "p1",
    name: "Ana Prieto",
    managerName: "Marta Quiroga",
    department: "Ingeniería",
    jobTitle: "Developer",
    removed: false,
  },
  goals: [goal()],
  goalsAsOf: new Date("2025-01-15T12:00:00Z"),
  reviews: [
    {
      relationship: "manager",
      reviewerName: "Marta Quiroga",
      reviewerMismatch: false,
      review: review(),
    },
  ],
  ...over,
});

describe("ParticipantAssessmentView", () => {
  it.each(locales)(
    "shows the header, the answers and the goals block in %s",
    (locale) => {
      renderIn(locale, <ParticipantAssessmentView data={data()} />);
      expect(
        screen.getByRole("heading", { level: 1, name: "Ana Prieto · H1 2024" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", {
          name: locale === "es" ? "Volver al ciclo" : "Back to the cycle",
        }),
      ).toHaveAttribute("href", "/cycles/c1");
      expect(
        screen.getByText(/Marta Quiroga/, { selector: "p" }),
      ).toHaveTextContent(
        locale === "es"
          ? "Manager del snapshot: Marta Quiroga"
          : "Manager at the snapshot: Marta Quiroga",
      );
      const answers = screen.getByTestId("assessment-answers");
      const manager = within(answers).getByRole("article", {
        name: locale === "es" ? "Evaluación del manager" : "Manager assessment",
      });
      expect(manager).toHaveTextContent(
        locale === "es" ? "Probablemente se vaya" : "Likely to leave",
      );
      expect(manager).toHaveTextContent("Lidera bien al equipo");
      expect(manager).toHaveTextContent(
        locale === "es" ? "Evaluó: Marta Quiroga" : "Written by: Marta Quiroga",
      );
      // The goals of the period sit next to the answers.
      expect(screen.getByTestId("period-goals")).toHaveTextContent(
        "Migrar el módulo de pagos",
      );
    },
  );

  it("marks a review written by someone who was not the snapshot manager", () => {
    renderIn(
      "es",
      <ParticipantAssessmentView
        data={data({
          reviews: [
            {
              relationship: "manager",
              reviewerName: "Nora Salas",
              reviewerMismatch: true,
              review: review(),
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText("Quien evaluó no es el manager del snapshot"),
    ).toBeInTheDocument();
  });

  it("explains an empty detail: no reviews, a removed participant, no manager, nothing visible", () => {
    renderIn(
      "es",
      <ParticipantAssessmentView
        data={data({
          reviews: [],
          goals: [],
          goalsAsOf: null,
          participant: {
            id: "p1",
            name: "Dario Mena",
            managerName: null,
            department: null,
            jobTitle: null,
            removed: true,
          },
        })}
      />,
    );
    expect(
      screen.getByText("No hay evaluaciones enviadas de esta persona."),
    ).toBeInTheDocument();
    expect(screen.getByText("Quitado del ciclo")).toBeInTheDocument();
    expect(screen.getByText(/Sin manager en el snapshot/)).toBeInTheDocument();
    expect(
      screen.getByText("No hay objetivos en este período."),
    ).toBeInTheDocument();
  });

  it("a review whose questions the viewer may not read says so", () => {
    renderIn(
      "en",
      <ParticipantAssessmentView
        data={data({
          reviews: [
            {
              relationship: "self",
              reviewerName: "Ana Prieto",
              reviewerMismatch: false,
              review: review({ questions: [], answers: {} }),
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText("There are no answers visible to you."),
    ).toBeInTheDocument();
  });
});
