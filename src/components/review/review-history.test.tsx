import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { AcknowledgeTasks } from "./acknowledge-box";
import { MyTasksView } from "./my-tasks";
import { type HistoryItemView, ReviewHistory } from "./review-history";
import type { SelfReviewData } from "./self-review-form";
import { TeamView, type TeamViewRow } from "./team-view";

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

const reviewData = (
  prompt: { es: string; en: string },
  answer: string,
): SelfReviewData => ({
  requestId: "r",
  cycleName: "H1 2022",
  dueDate: null,
  status: "submitted",
  submittedAt: new Date("2022-07-01T00:00:00Z"),
  canWrite: false,
  questions: [
    {
      id: "q",
      sectionTitle: { es: "Sección", en: "Section" },
      prompt,
      kind: "text",
      required: true,
      scale: null,
      choices: null,
    },
  ],
  answers: { q: answer },
});

function item(overrides: Partial<HistoryItemView> = {}): HistoryItemView {
  return {
    participantId: "p1",
    cycleId: "c1",
    cycleName: "H1 2022",
    periodStart: "2022-01-01",
    periodEnd: "2022-06-30",
    cycleStatus: "closed",
    managerPersonId: "m1",
    managerName: "Carla Romero",
    jobTitle: "Developer",
    department: "Ingeniería",
    sharedAt: new Date("2022-07-10T12:00:00Z"),
    acknowledgedAt: new Date("2022-07-12T12:00:00Z"),
    rating: {
      value: 3,
      label: { es: "Cumple", en: "Meets" },
      normalized: 2 / 3,
    },
    self: reviewData(
      { es: "¿Qué lograste?", en: "What did you achieve?" },
      "Mucho",
    ),
    manager: reviewData(
      { es: "¿Cómo le fue?", en: "How did they do?" },
      "Muy bien",
    ),
    canCompare: true,
    ...overrides,
  };
}

describe("ReviewHistory", () => {
  it("says there is nothing yet (es)", () => {
    renderIn("es", <ReviewHistory personName="Bruno Pérez" items={[]} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Evaluaciones de Bruno Pérez",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Todavía no hay evaluaciones finalizadas ni compartidas.",
      ),
    ).toBeVisible();
  });

  it("shows each cycle with the manager and job of that moment, rating and states (es)", () => {
    renderIn("es", <ReviewHistory personName="Bruno Pérez" items={[item()]} />);
    const card = screen.getByRole("article", { name: "H1 2022" });
    expect(within(card).getByText("1 ene 2022 a 30 jun 2022")).toBeVisible();
    expect(
      within(card).getByText("Manager en ese momento: Carla Romero"),
    ).toBeVisible();
    expect(
      within(card).getByText(
        "Puesto y área en ese momento: Developer, Ingeniería",
      ),
    ).toBeVisible();
    expect(within(card).getByText("Cumple (67%)")).toBeVisible();
    expect(within(card).getByText("Compartida el 10 jul 2022")).toBeVisible();
    expect(
      within(card).getByText("Acuse de recibo el 12 jul 2022"),
    ).toBeVisible();
    expect(
      within(card).getByRole("link", {
        name: "Comparar autoevaluación y evaluación",
      }),
    ).toHaveAttribute("href", "/cycles/c1/compare/p1");
  });

  it("includes the readable answers of both reviews", async () => {
    const user = userEvent.setup();
    renderIn("es", <ReviewHistory personName="Bruno Pérez" items={[item()]} />);
    await user.click(screen.getByText("Ver respuestas"));
    expect(screen.getByText("¿Qué lograste?")).toBeVisible();
    expect(screen.getByText("Mucho")).toBeVisible();
    expect(screen.getByText("¿Cómo le fue?")).toBeVisible();
    expect(screen.getByText("Muy bien")).toBeVisible();
  });

  it("renders a cycle without rating, acknowledgement, manager review or compare link (en)", () => {
    renderIn(
      "en",
      <ReviewHistory
        personName="Bruno Pérez"
        items={[
          item({
            cycleName: "H1 2024",
            managerName: null,
            jobTitle: null,
            department: null,
            rating: null,
            sharedAt: null,
            acknowledgedAt: null,
            manager: null,
            canCompare: false,
          }),
        ]}
      />,
    );
    const card = screen.getByRole("article", { name: "H1 2024" });
    expect(within(card).getByText("No manager at the time")).toBeVisible();
    expect(within(card).getByText("No rating")).toBeVisible();
    expect(within(card).getByText("Not shared")).toBeVisible();
    expect(within(card).getByText("Not acknowledged")).toBeVisible();
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    expect(within(card).queryByText("Manager review")).not.toBeInTheDocument();
  });

  it("lists cycles in the given order", () => {
    renderIn(
      "es",
      <ReviewHistory
        personName="Bruno Pérez"
        items={[
          item({ participantId: "a", cycleName: "H1 2024" }),
          item({ participantId: "b", cycleName: "H1 2022" }),
        ]}
      />,
    );
    expect(
      screen.getAllByRole("article").map((a) => a.getAttribute("aria-label")),
    ).toEqual(["H1 2024", "H1 2022"]);
  });
});

describe("AcknowledgeTasks (/me)", () => {
  it("links each pending acknowledgement to the shared review", () => {
    renderIn(
      "es",
      <AcknowledgeTasks
        tasks={[
          {
            participantId: "p1",
            cycleId: "c1",
            cycleName: "H1 2026",
            deadline: new Date("2026-03-17T15:30:00Z"),
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Acusar recibo" }),
    ).toBeVisible();
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Acusar recibo: H1 2026")).toBeVisible();
    expect(within(row).getByText("Hasta el 17 mar 2026")).toBeVisible();
    expect(
      within(row).getByRole("link", { name: "Acusar recibo" }),
    ).toHaveAttribute("href", "/cycles/c1/result#acknowledge");
  });

  it("renders nothing without tasks", () => {
    renderIn("en", <AcknowledgeTasks tasks={[]} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});

describe("MyTasksView acknowledgements", () => {
  const ack = {
    participantId: "p1",
    cycleId: "c1",
    cycleName: "H1 2026",
    deadline: new Date("2026-03-17T15:30:00Z"),
  };

  it("counts an acknowledgement as a task and links to the history", () => {
    renderIn(
      "es",
      <MyTasksView
        hasPerson
        personId="person-1"
        tasks={{
          selfAssessments: [],
          sharedReviews: [],
          acknowledgements: [ack],
        }}
      />,
    );
    expect(screen.queryByText("No tenés tareas pendientes.")).toBeNull();
    expect(screen.getByText("Acusar recibo: H1 2026")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Mi historial de evaluaciones" }),
    ).toHaveAttribute("href", "/people/person-1/reviews");
  });

  it("is empty without tasks but keeps the history link (en)", () => {
    renderIn(
      "en",
      <MyTasksView
        hasPerson
        personId="person-1"
        tasks={{ selfAssessments: [], sharedReviews: [] }}
      />,
    );
    expect(screen.getByText("You have no pending tasks.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "My review history" }),
    ).toHaveAttribute("href", "/people/person-1/reviews");
  });

  it("has no history link without a person", () => {
    renderIn(
      "es",
      <MyTasksView
        hasPerson={false}
        personId={null}
        tasks={{ selfAssessments: [], sharedReviews: [] }}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("TeamView compare and history links", () => {
  const row = (overrides: Partial<TeamViewRow> = {}): TeamViewRow => ({
    cycleId: "c1",
    cycleName: "H1 2026",
    participantId: "p1",
    revieweePersonId: "person-1",
    revieweeName: "Bruno Pérez",
    selfRequestId: "s1",
    selfStatus: "submitted",
    managerRequestId: "m1",
    managerStatus: "submitted",
    sharedAt: null,
    ...overrides,
  });
  const ok = async () => ({ ok: true as const });

  it("links to the comparison once both reviews are submitted, and to the history", () => {
    renderIn("es", <TeamView hasPerson rows={[row()]} remind={ok} />);
    expect(screen.getByRole("link", { name: "Comparar" })).toHaveAttribute(
      "href",
      "/cycles/c1/compare/p1",
    );
    expect(screen.getByRole("link", { name: "Evaluaciones" })).toHaveAttribute(
      "href",
      "/people/person-1/reviews",
    );
  });

  it("offers no comparison while a review is a draft", () => {
    renderIn(
      "es",
      <TeamView
        hasPerson
        rows={[row({ managerStatus: "draft" })]}
        remind={ok}
      />,
    );
    expect(screen.queryByRole("link", { name: "Comparar" })).toBeNull();
  });
});
