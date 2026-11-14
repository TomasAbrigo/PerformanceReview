import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ActorSelector } from "@/components/actor/actor-selector";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { MyTasksView } from "./my-tasks";
import { SelfStatusCell } from "./self-status-cell";
import { type SelfReviewData, SelfReviewForm } from "./self-review-form";

const routerRefresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh, push: vi.fn() }),
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
const REQ = "00000000-0000-4000-8000-0000000000r1";
const BRUNO = "00000000-0000-4000-8000-000000000002";

// ------------------------------------------------------------------ inbox

describe("MyTasksView", () => {
  it.each([
    ["es", "Mis tareas", "No tenés tareas pendientes."],
    ["en", "My tasks", "You have no pending tasks."],
  ] as const)("shows the empty state in %s", (locale, h, empty) => {
    renderIn(
      locale,
      <MyTasksView
        hasPerson
        tasks={{ selfAssessments: [], sharedReviews: [] }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: h })).toBeVisible();
    expect(screen.getByText(empty)).toBeVisible();
  });

  it("asks to pick a person when acting without one", () => {
    renderIn(
      "es",
      <MyTasksView
        hasPerson={false}
        tasks={{ selfAssessments: [], sharedReviews: [] }}
      />,
    );
    expect(screen.getByText(/Elegí una persona/)).toBeVisible();
  });

  it.each([
    ["es", "Autoevaluación: H1 2026", "Vence el", "Completar"],
    ["en", "Self assessment: H1 2026", "Due", "Fill in"],
  ] as const)(
    "lists a pending self assessment in %s",
    (locale, title, due, open) => {
      renderIn(
        locale,
        <MyTasksView
          hasPerson
          tasks={{
            selfAssessments: [
              {
                requestId: REQ,
                cycleId: CYCLE,
                cycleName: "H1 2026",
                dueDate: "2026-07-15",
                status: "draft",
              },
            ],
            sharedReviews: [],
          }}
        />,
      );
      const item = screen.getByRole("listitem");
      expect(within(item).getByText(title)).toBeVisible();
      expect(within(item).getByText(new RegExp(due))).toBeVisible();
      expect(within(item).getByRole("link", { name: open })).toHaveAttribute(
        "href",
        `/cycles/${CYCLE}/self`,
      );
    },
  );
});

// ------------------------------------------------------------------- form

const QUESTIONS: SelfReviewData["questions"] = [
  {
    id: "q1",
    sectionTitle: { es: "Logros", en: "Achievements" },
    prompt: { es: "¿Qué lograste?", en: "What did you achieve?" },
    kind: "text",
    required: true,
    scale: null,
    choices: null,
  },
  {
    id: "q2",
    sectionTitle: { es: "Logros", en: "Achievements" },
    prompt: { es: "¿Cómo te fue?", en: "How did it go?" },
    kind: "rating",
    required: false,
    scale: {
      options: [
        { value: 1, label: { es: "Mal", en: "Bad" }, normalized: 0 },
        { value: 2, label: { es: "Bien", en: "Good" }, normalized: 1 },
      ],
    },
    choices: null,
  },
];

function review(overrides: Partial<SelfReviewData> = {}): SelfReviewData {
  return {
    requestId: REQ,
    cycleName: "H1 2026",
    dueDate: "2026-07-15",
    status: "draft",
    submittedAt: null,
    canWrite: true,
    questions: QUESTIONS,
    answers: {},
    ...overrides,
  };
}

const actions = () => ({
  save: vi.fn(async () => ({ ok: true as const })),
  submit: vi.fn(async () => ({ ok: true as const })),
});

describe("SelfReviewForm", () => {
  it.each([
    ["es", "¿Qué lograste?", "Bien", "Enviar"],
    ["en", "What did you achieve?", "Good", "Submit"],
  ] as const)(
    "renders an empty draft in %s",
    (locale, prompt, option, send) => {
      renderIn(
        locale,
        <SelfReviewForm review={review()} actions={actions()} />,
      );
      expect(screen.getByLabelText(new RegExp(prompt))).toHaveValue("");
      expect(screen.getByRole("radio", { name: option })).not.toBeChecked();
      expect(screen.getByRole("button", { name: send })).toBeEnabled();
    },
  );

  it("renders the intro (the goals block) above the questions", () => {
    renderIn(
      "es",
      <SelfReviewForm
        review={review()}
        actions={actions()}
        intro={<p>Objetivos del período</p>}
      />,
    );
    const intro = screen.getByText("Objetivos del período");
    const question = screen.getByLabelText(/¿Qué lograste\?/);
    expect(
      intro.compareDocumentPosition(question) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("autosaves a text answer on blur", async () => {
    const a = actions();
    renderIn("es", <SelfReviewForm review={review()} actions={a} />);
    const box = screen.getByLabelText(/¿Qué lograste\?/);
    await userEvent.type(box, "Mucho");
    await userEvent.tab();
    await waitFor(() =>
      expect(a.save).toHaveBeenCalledWith(REQ, [
        { questionRevisionId: "q1", value: "Mucho" },
      ]),
    );
    expect(await screen.findByText("Borrador guardado")).toBeVisible();
  });

  it("saves a rating when chosen", async () => {
    const a = actions();
    renderIn("es", <SelfReviewForm review={review()} actions={a} />);
    await userEvent.click(screen.getByRole("radio", { name: "Bien" }));
    await waitFor(() =>
      expect(a.save).toHaveBeenCalledWith(REQ, [
        { questionRevisionId: "q2", value: 2 },
      ]),
    );
  });

  it("shows the draft answers", () => {
    renderIn(
      "es",
      <SelfReviewForm
        review={review({ answers: { q1: "Algo", q2: 1 } })}
        actions={actions()}
      />,
    );
    expect(screen.getByLabelText(/¿Qué lograste\?/)).toHaveValue("Algo");
    expect(screen.getByRole("radio", { name: "Mal" })).toBeChecked();
  });

  it("submits after confirmation", async () => {
    const a = actions();
    renderIn(
      "es",
      <SelfReviewForm review={review({ answers: { q1: "x" } })} actions={a} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(a.submit).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar envío" }),
    );
    await waitFor(() => expect(a.submit).toHaveBeenCalledWith(REQ));
  });

  it.each([
    [
      "es",
      "Completá las preguntas obligatorias.",
      "Esta pregunta es obligatoria.",
    ],
    ["en", "Answer the required questions.", "This question is required."],
  ] as const)(
    "shows missing required answers in %s",
    async (locale, msg, field) => {
      const a = actions();
      a.submit.mockResolvedValueOnce({
        ok: false,
        code: "missing_required",
        issues: [{ path: "q1", message: "required" }],
      } as never);
      renderIn(locale, <SelfReviewForm review={review()} actions={a} />);
      await userEvent.click(
        screen.getByRole("button", {
          name: locale === "es" ? "Enviar" : "Submit",
        }),
      );
      await userEvent.click(
        screen.getByRole("button", {
          name: locale === "es" ? "Confirmar envío" : "Confirm submission",
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(msg);
      expect(screen.getByText(field)).toBeVisible();
    },
  );

  it.each([
    ["es", "Enviado el"],
    ["en", "Submitted on"],
  ] as const)("is read-only once submitted in %s", (locale, sent) => {
    renderIn(
      locale,
      <SelfReviewForm
        review={review({
          status: "submitted",
          submittedAt: new Date("2026-07-01T10:00:00Z"),
          canWrite: false,
          answers: { q1: "Mucho", q2: 2 },
        })}
        actions={actions()}
      />,
    );
    expect(screen.getByText(new RegExp(sent))).toBeVisible();
    expect(screen.getByText("Mucho")).toBeVisible();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: /Enviar|Submit/ })).toBeNull();
  });
});

// ---------------------------------------------------------- actor selector

describe("ActorSelector", () => {
  const people = [
    { id: "00000000-0000-4000-8000-000000000001", displayName: "Ana García" },
    { id: BRUNO, displayName: "Bruno Pérez" },
  ];

  it.each([
    ["es", "Actuando como: People (RR. HH.)"],
    ["en", "Acting as: People (HR)"],
  ] as const)("shows the default actor in %s", (locale, text) => {
    renderIn(
      locale,
      <ActorSelector
        actor={{ personId: null, role: "hr" }}
        actorName={null}
        people={people}
        setActor={vi.fn()}
      />,
    );
    expect(screen.getByText(text)).toBeVisible();
  });

  it("searches a person and applies person + role", async () => {
    const setActor = vi.fn(async () => ({ ok: true as const }));
    renderIn(
      "es",
      <ActorSelector
        actor={{ personId: null, role: "hr" }}
        actorName={null}
        people={people}
        setActor={setActor}
      />,
    );
    await userEvent.type(screen.getByLabelText("Buscar persona"), "bru");
    const select = screen.getByLabelText("Persona");
    expect(
      within(select).queryByRole("option", { name: "Ana García" }),
    ).toBeNull();
    await userEvent.selectOptions(select, BRUNO);
    await userEvent.selectOptions(screen.getByLabelText("Rol"), "employee");
    await userEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() =>
      expect(setActor).toHaveBeenCalledWith(BRUNO, "employee"),
    );
  });
});

// ------------------------------------------------------- autosave vs submit

describe("SelfReviewForm submit while saving", () => {
  it("disables Submit while a save is in flight", async () => {
    let resolve!: (v: { ok: true }) => void;
    const a = actions();
    a.save.mockImplementationOnce(
      () => new Promise<{ ok: true }>((r) => (resolve = r)),
    );
    renderIn("es", <SelfReviewForm review={review()} actions={a} />);
    await userEvent.type(screen.getByLabelText(/¿Qué lograste\?/), "x");
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
    resolve({ ok: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled(),
    );
  });

  it("waits for the pending autosave before submitting", async () => {
    const order: string[] = [];
    let resolve!: (v: { ok: true }) => void;
    const a = actions();
    a.save.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((r) => {
          resolve = (v) => {
            order.push("saved");
            r(v);
          };
        }),
    );
    a.submit.mockImplementation(async () => {
      order.push("submit");
      return { ok: true as const };
    });
    renderIn("es", <SelfReviewForm review={review()} actions={a} />);
    await userEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await userEvent.type(screen.getByLabelText(/¿Qué lograste\?/), "x");
    // Clicking confirm blurs the textarea: the save starts, then submit.
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar envío" }),
    );
    expect(a.submit).not.toHaveBeenCalled();
    resolve({ ok: true });
    await waitFor(() => expect(order).toEqual(["saved", "submit"]));
  });
});

// ------------------------------------------------------------ unlock cell

describe("SelfStatusCell", () => {
  it.each([
    ["es", "La evaluación no está enviada."],
    ["en", "The review is not submitted."],
  ] as const)(
    "shows the server error and refreshes in %s",
    async (locale, msg) => {
      const unlock = vi.fn(async () => ({
        ok: false as const,
        code: "not_submitted",
        issues: [],
      }));
      renderIn(
        locale,
        <SelfStatusCell
          request={{ requestId: REQ, status: "submitted" }}
          canUnlock
          unlock={unlock}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", {
          name: locale === "es" ? "Desbloquear" : "Unlock",
        }),
      );
      await userEvent.click(
        screen.getByRole("button", {
          name: locale === "es" ? "Confirmar desbloqueo" : "Confirm unlock",
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(msg);
      expect(routerRefresh).toHaveBeenCalled();
    },
  );
});
