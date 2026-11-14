import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { ManagerResultView } from "./manager-result";
import { MyTasksView } from "./my-tasks";
import {
  type ManagerReviewData,
  ManagerReviewForm,
} from "./manager-review-form";
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

const CYCLE = "00000000-0000-4000-8000-0000000000c1";
const REQ = "00000000-0000-4000-8000-0000000000a1";
const SELF = "00000000-0000-4000-8000-0000000000a2";
const PART = "00000000-0000-4000-8000-0000000000b1";

const rating = {
  options: [
    { value: 1, label: { es: "Bajo", en: "Low" }, normalized: 0 },
    { value: 2, label: { es: "Alto", en: "High" }, normalized: 1 },
  ],
};

function managerReview(
  overrides: Partial<ManagerReviewData> = {},
): ManagerReviewData {
  return {
    requestId: REQ,
    cycleId: CYCLE,
    cycleName: "H1 2026",
    revieweeName: "Bruno Pérez",
    dueDate: "2026-07-30",
    status: "draft",
    submittedAt: null,
    sharedAt: null,
    canWrite: true,
    canShare: false,
    questions: [
      {
        id: "q1",
        sectionTitle: { es: "Evaluación del manager", en: "Manager review" },
        prompt: { es: "Calificación general", en: "Overall rating" },
        kind: "rating",
        required: true,
        scale: rating,
        choices: null,
        visibleToReviewee: true,
      },
      {
        id: "q2",
        sectionTitle: { es: "Evaluación del manager", en: "Manager review" },
        prompt: { es: "Notas privadas", en: "Private notes" },
        kind: "text",
        required: false,
        scale: null,
        choices: null,
        visibleToReviewee: false,
      },
    ],
    answers: {},
    ...overrides,
  };
}

const selfReview: SelfReviewData = {
  requestId: SELF,
  cycleName: "H1 2026",
  dueDate: null,
  status: "submitted",
  submittedAt: new Date("2026-07-01T10:00:00Z"),
  canWrite: false,
  questions: [
    {
      id: "s1",
      sectionTitle: { es: "Autoevaluación", en: "Self-reflection" },
      prompt: { es: "¿Qué lograste?", en: "What did you achieve?" },
      kind: "text",
      required: true,
      scale: null,
      choices: null,
    },
  ],
  answers: { s1: "Lancé el producto" },
};

const ok = async () => ({ ok: true as const });
const actions = { save: vi.fn(ok), submit: vi.fn(ok), share: vi.fn(ok) };

describe("ManagerReviewForm", () => {
  it.each([
    [
      "es",
      "Evaluación de Bruno Pérez",
      "El empleado verá",
      "El empleado no verá",
      "Objetivos",
    ],
    [
      "en",
      "Review of Bruno Pérez",
      "The employee will see this",
      "The employee will not see this",
      "Goals",
    ],
  ] as const)(
    "renders a draft with visibility marks and the goals placeholder in %s",
    (locale, title, visible, hidden, goals) => {
      renderIn(
        locale,
        <ManagerReviewForm
          review={managerReview()}
          self={null}
          actions={actions}
        />,
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        title,
      );
      expect(screen.getByText(visible)).toBeVisible();
      expect(screen.getByText(hidden)).toBeVisible();
      expect(screen.getByRole("heading", { name: goals })).toBeVisible();
      expect(
        screen.getByRole("radio", { name: locale === "es" ? "Alto" : "High" }),
      ).toBeEnabled();
      expect(
        screen.queryByRole("button", { name: /Compartir|Share/ }),
      ).toBeNull();
    },
  );

  it("autosaves a rating", async () => {
    renderIn(
      "es",
      <ManagerReviewForm
        review={managerReview()}
        self={null}
        actions={actions}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Alto" }));
    await waitFor(() =>
      expect(actions.save).toHaveBeenCalledWith(REQ, [
        { questionRevisionId: "q1", value: 2 },
      ]),
    );
  });

  it("explains that the self review is hidden under double blind", () => {
    renderIn(
      "es",
      <ManagerReviewForm
        review={managerReview()}
        self={null}
        actions={actions}
      />,
    );
    expect(screen.getByText(/se mostrará cuando ambos/)).toBeVisible();
  });

  it("shows a submitted review with the self answers side by side and shares it", async () => {
    renderIn(
      "es",
      <ManagerReviewForm
        review={managerReview({
          status: "submitted",
          submittedAt: new Date("2026-07-10T10:00:00Z"),
          canWrite: false,
          canShare: true,
          answers: { q1: 2 },
        })}
        self={selfReview}
        actions={actions}
      />,
    );
    expect(screen.getByText("Alto")).toBeVisible();
    const aside = screen.getByRole("complementary", { name: "Autoevaluación" });
    expect(within(aside).getByText("Lancé el producto")).toBeVisible();
    expect(
      screen.getByText("Aún no compartida con el empleado."),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Compartir con el empleado" }),
    );
    await waitFor(() => expect(actions.share).toHaveBeenCalledWith(REQ));
  });

  it("shows when it was shared (en)", () => {
    renderIn(
      "en",
      <ManagerReviewForm
        review={managerReview({
          status: "submitted",
          canWrite: false,
          canShare: true,
          sharedAt: new Date("2026-07-12T10:00:00Z"),
        })}
        self={selfReview}
        actions={actions}
      />,
    );
    expect(screen.getByText(/Shared on/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Share/ })).toBeNull();
  });
});

const row = (overrides: Partial<TeamViewRow> = {}): TeamViewRow => ({
  cycleId: CYCLE,
  cycleName: "H1 2026",
  participantId: PART,
  revieweeName: "Bruno Pérez",
  selfRequestId: SELF,
  selfStatus: "draft",
  managerRequestId: REQ,
  managerStatus: "draft",
  sharedAt: null,
  ...overrides,
});

describe("TeamView", () => {
  it.each([
    ["es", "Mi equipo", "No tenés reportes directos en ciclos activos."],
    ["en", "My team", "You have no direct reports in active cycles."],
  ] as const)("shows the empty state in %s", (locale, h, empty) => {
    renderIn(locale, <TeamView hasPerson rows={[]} remind={vi.fn(ok)} />);
    expect(screen.getByRole("heading", { level: 1, name: h })).toBeVisible();
    expect(screen.getByText(empty)).toBeVisible();
  });

  it.each([
    [
      "es",
      "Reportes directos",
      "Borrador",
      "Enviada",
      "Evaluar",
      "Recordar",
      "Sí",
    ],
    ["en", "Direct reports", "Draft", "Submitted", "Review", "Remind", "Yes"],
  ] as const)(
    "lists reports with statuses in %s and records a reminder",
    async (locale, table, draft, submitted, open, remind, yes) => {
      const remindFn = vi.fn(ok);
      renderIn(
        locale,
        <TeamView
          hasPerson
          rows={[
            row(),
            row({
              participantId: "p2",
              revieweeName: "Ana García",
              selfStatus: "submitted",
              managerStatus: "submitted",
              sharedAt: new Date("2026-07-12T10:00:00Z"),
            }),
          ]}
          remind={remindFn}
        />,
      );
      const rows = within(
        screen.getByRole("table", { name: table }),
      ).getAllByRole("row");
      const bruno = rows.find((r) => r.textContent?.includes("Bruno"))!;
      const ana = rows.find((r) => r.textContent?.includes("Ana"))!;
      expect(within(bruno).getAllByText(draft)).toHaveLength(2);
      expect(within(ana).getAllByText(submitted)).toHaveLength(2);
      expect(within(ana).getByText(yes)).toBeVisible();
      expect(within(bruno).getByRole("link", { name: open })).toHaveAttribute(
        "href",
        `/cycles/${CYCLE}/manager/${PART}`,
      );
      expect(within(ana).queryByRole("button", { name: remind })).toBeNull();
      await userEvent.click(
        within(bruno).getByRole("button", { name: remind }),
      );
      await waitFor(() => expect(remindFn).toHaveBeenCalledWith(SELF));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "Bruno Pérez",
      );
    },
  );
});

describe("ManagerResultView", () => {
  const shared: SelfReviewData = {
    requestId: REQ,
    cycleName: "H1 2026",
    dueDate: null,
    status: "submitted",
    submittedAt: new Date("2026-07-10T10:00:00Z"),
    canWrite: false,
    questions: [managerReview().questions[0]],
    answers: { q1: 2 },
  };

  it.each([
    ["es", "Evaluación de tu manager: H1 2026", "Alto"],
    ["en", "Your manager's review: H1 2026", "High"],
  ] as const)(
    "shows the shared answers read-only in %s",
    (locale, h, answer) => {
      renderIn(locale, <ManagerResultView review={shared} />);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(h);
      expect(screen.getByText(answer)).toBeVisible();
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.queryByText("Notas privadas")).toBeNull();
    },
  );

  it("says when nothing was shared yet", () => {
    renderIn("es", <ManagerResultView review={null} />);
    expect(
      screen.getByText("Tu evaluación todavía no fue compartida."),
    ).toBeVisible();
  });
});

describe("MyTasksView shared reviews", () => {
  it.each([
    ["es", "Evaluación compartida: H1 2026", "Ver"],
    ["en", "Shared review: H1 2026", "View"],
  ] as const)("links to the shared review in %s", (locale, title, view) => {
    renderIn(
      locale,
      <MyTasksView
        hasPerson
        tasks={{
          selfAssessments: [],
          sharedReviews: [
            {
              requestId: REQ,
              cycleId: CYCLE,
              cycleName: "H1 2026",
              sharedAt: new Date(),
            },
          ],
        }}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent(title);
    expect(within(item).getByRole("link", { name: view })).toHaveAttribute(
      "href",
      `/cycles/${CYCLE}/result`,
    );
  });
});
