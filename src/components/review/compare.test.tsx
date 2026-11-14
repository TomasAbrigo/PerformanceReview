import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { CompareRow, Comparison } from "@/modules/review-core/compare";
import { AcknowledgeBox, type AckViewState } from "./acknowledge-box";
import { CompareView } from "./compare-view";
import { FollowUpNotes, type FollowUpNoteView } from "./follow-up-notes";

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

const PART = "00000000-0000-4000-8000-0000000000b1";
const scale = {
  options: [
    { value: 1, label: { es: "Bajo", en: "Low" }, normalized: 0 },
    { value: 2, label: { es: "Medio", en: "Medium" }, normalized: 0.5 },
    { value: 3, label: { es: "Alto", en: "High" }, normalized: 1 },
  ],
};
const section = { es: "Desempeño", en: "Performance" };

function row(
  id: string,
  overrides: Partial<Omit<CompareRow, "question">> & {
    question?: Partial<CompareRow["question"]>;
  },
): CompareRow {
  const { question, ...rest } = overrides;
  return {
    question: {
      id,
      sectionTitle: section,
      prompt: { es: `Pregunta ${id}`, en: `Question ${id}` },
      kind: "text",
      scale: null,
      choices: null,
      visibleToReviewee: true,
      required: true,
      sort: 0,
      ...question,
    },
    self: { value: "Mi texto", normalized: null },
    manager: { value: "Su texto", normalized: null },
    delta: null,
    ...rest,
  };
}

const ratingQuestion = {
  kind: "rating" as const,
  scale,
};

function comparison(overrides: Partial<Comparison> = {}): Comparison {
  return {
    participantId: PART,
    cycleId: "c1",
    cycleName: "H1 2026",
    revieweePersonId: "00000000-0000-4000-8000-0000000000e1",
    revieweeName: "Bruno Pérez",
    sharedAt: null,
    employeeView: false,
    rows: [
      row("rating-up", {
        question: {
          ...ratingQuestion,
          prompt: { es: "Objetivos", en: "Goals" },
        },
        self: { value: 1, normalized: 0 },
        manager: { value: 2, normalized: 0.5 },
        delta: { numeric: 1, normalized: 0.5 },
      }),
      row("rating-down", {
        question: { ...ratingQuestion, prompt: { es: "Equipo", en: "Team" } },
        self: { value: 3, normalized: 1 },
        manager: { value: 1, normalized: 0 },
        delta: { numeric: -2, normalized: -1 },
      }),
      row("rating-same", {
        question: {
          ...ratingQuestion,
          prompt: { es: "Calidad", en: "Quality" },
        },
        self: { value: 2, normalized: 0.5 },
        manager: { value: 2, normalized: 0.5 },
        delta: { numeric: 0, normalized: 0 },
      }),
      row("text-both", {
        question: { prompt: { es: "Comentarios", en: "Comments" } },
      }),
      row("manager-only", {
        question: { prompt: { es: "Sólo manager", en: "Manager only" } },
        self: null,
        manager: { value: "Privado", normalized: null },
      }),
      row("hidden", {
        question: {
          prompt: { es: "Nota privada", en: "Private note" },
          visibleToReviewee: false,
        },
        self: null,
        manager: { value: "Solo para People", normalized: null },
      }),
      row("unanswered", {
        question: { prompt: { es: "Sin responder", en: "Unanswered" } },
        self: { value: null, normalized: null },
      }),
    ],
    ...overrides,
  };
}

const rowFor = (name: string | RegExp) =>
  screen.getByRole("row", {
    name: new RegExp(typeof name === "string" ? name : name.source),
  });

describe("CompareView", () => {
  it("shows self and manager answers per question with the delta on ratings (es)", () => {
    renderIn("es", <CompareView comparison={comparison()} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Comparación: Bruno Pérez",
      }),
    ).toBeInTheDocument();

    const up = rowFor("Objetivos");
    expect(within(up).getByText("Bajo")).toBeInTheDocument();
    expect(within(up).getByText("Medio")).toBeInTheDocument();
    expect(
      within(up).getByText("El manager calificó más alto: +1 (+50%)"),
    ).toBeInTheDocument();

    expect(
      within(rowFor("Equipo")).getByText(
        "El manager calificó más bajo: -2 (-100%)",
      ),
    ).toBeInTheDocument();
    expect(
      within(rowFor("Calidad")).getByText("Sin diferencia"),
    ).toBeInTheDocument();
  });

  it("shows nothing as a difference for non-rating questions", () => {
    renderIn("es", <CompareView comparison={comparison()} />);
    const text = rowFor("Comentarios");
    expect(within(text).getByText("Mi texto")).toBeInTheDocument();
    expect(within(text).getByText("Su texto")).toBeInTheDocument();
    expect(within(text).getByText("—")).toBeInTheDocument();
    expect(within(text).queryByText(/calificó/)).not.toBeInTheDocument();
  });

  it("marks questions asked to one side only and unanswered ones", () => {
    renderIn("es", <CompareView comparison={comparison()} />);
    const only = rowFor("Sólo manager");
    expect(within(only).getByText("No se pregunta")).toBeInTheDocument();
    expect(within(only).getByText("Privado")).toBeInTheDocument();
    expect(
      within(rowFor("Sin responder")).getByText("Sin respuesta"),
    ).toBeInTheDocument();
  });

  it("renders in English", () => {
    renderIn("en", <CompareView comparison={comparison()} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Comparison: Bruno Pérez",
      }),
    ).toBeInTheDocument();
    const up = rowFor("Goals");
    expect(within(up).getByText("Low")).toBeInTheDocument();
    expect(
      within(up).getByText("The manager rated higher: +1 (+50%)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Employee view" }),
    ).toBeVisible();
  });

  it("flags questions the employee will not see", () => {
    renderIn("es", <CompareView comparison={comparison()} />);
    const hidden = rowFor("Nota privada");
    expect(
      within(hidden).getByText("El empleado no verá esto"),
    ).toBeInTheDocument();
    expect(within(rowFor("Objetivos")).queryByText(/no verá/)).toBeNull();
  });

  it("the employee view toggle hides what the employee cannot see", async () => {
    const user = userEvent.setup();
    renderIn("es", <CompareView comparison={comparison()} />);
    const toggle = screen.getByRole("checkbox", { name: "Vista del empleado" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("Solo para People")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(screen.queryByText("Nota privada")).not.toBeInTheDocument();
    expect(screen.queryByText("Solo para People")).not.toBeInTheDocument();
    expect(
      screen.queryByText("El empleado no verá esto"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Mostrando solo lo que verá el empleado."),
    ).toBeInTheDocument();
    // Visible questions and their deltas stay.
    expect(
      within(rowFor("Objetivos")).getByText(/El manager calificó más alto/),
    ).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByText("Solo para People")).toBeInTheDocument();
  });

  it("the employee has no toggle: the view is always limited", () => {
    renderIn(
      "es",
      <CompareView
        comparison={comparison({
          employeeView: true,
          rows: comparison().rows.filter((r) => r.question.visibleToReviewee),
        })}
      />,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByText("Estás viendo solo las preguntas visibles para vos."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nota privada")).not.toBeInTheDocument();
  });

  it("says when there is nothing to compare", () => {
    renderIn("es", <CompareView comparison={comparison({ rows: [] })} />);
    expect(
      screen.getByText("No hay preguntas para comparar."),
    ).toBeInTheDocument();
  });
});

const note = (id: string, body: string, authorName: string | null) => ({
  id,
  body,
  authorName,
  createdAt: new Date("2026-03-10T15:00:00Z"),
});

describe("FollowUpNotes", () => {
  it("lists the notes in the given order with their author", () => {
    const notes: FollowUpNoteView[] = [
      note("2", "Revisar en abril", "Carla Romero"),
      note("1", "Nota de People", null),
    ];
    renderIn(
      "es",
      <FollowUpNotes participantId={PART} notes={notes} canAdd={false} />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Revisar en abril")).toBeInTheDocument();
    expect(within(items[0]).getByText(/Carla Romero/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/^People · /)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("is empty-friendly (en)", () => {
    renderIn(
      "en",
      <FollowUpNotes participantId={PART} notes={[]} canAdd={false} />,
    );
    expect(screen.getByText("There are no follow-up notes yet.")).toBeVisible();
  });

  it("adds a note and clears the field", async () => {
    const user = userEvent.setup();
    const add = vi.fn(async () => ({ ok: true as const }));
    renderIn(
      "es",
      <FollowUpNotes participantId={PART} notes={[]} canAdd add={add} />,
    );
    const box = screen.getByRole("textbox", {
      name: "Nueva nota de seguimiento",
    });
    await user.type(box, "Acordamos revisar en un mes");
    await user.click(screen.getByRole("button", { name: "Agregar nota" }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(PART, "Acordamos revisar en un mes"),
    );
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("shows the domain error and keeps the text", async () => {
    const user = userEvent.setup();
    const add = vi.fn(async () => ({
      ok: false as const,
      code: "validation",
      issues: [{ path: "body", message: "too_long" }],
    }));
    renderIn(
      "es",
      <FollowUpNotes participantId={PART} notes={[]} canAdd add={add} />,
    );
    const box = screen.getByRole("textbox", {
      name: "Nueva nota de seguimiento",
    });
    await user.type(box, "demasiado");
    await user.click(screen.getByRole("button", { name: "Agregar nota" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La nota es demasiado larga.",
    );
    expect(box).toHaveValue("demasiado");
  });

  it("does not submit an empty note", async () => {
    const user = userEvent.setup();
    const add = vi.fn(async () => ({ ok: true as const }));
    renderIn(
      "es",
      <FollowUpNotes participantId={PART} notes={[]} canAdd add={add} />,
    );
    await user.click(screen.getByRole("button", { name: "Agregar nota" }));
    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Escribí la nota.",
    );
  });
});

const ackState = (overrides: Partial<AckViewState> = {}): AckViewState => ({
  participantId: PART,
  status: "open",
  deadline: new Date("2026-03-17T15:30:00Z"),
  acknowledgedAt: null,
  note: null,
  ...overrides,
});

describe("AcknowledgeBox", () => {
  it("lets the employee acknowledge with an optional note while the window is open", async () => {
    const user = userEvent.setup();
    const acknowledge = vi.fn(async () => ({ ok: true as const }));
    renderIn(
      "es",
      <AcknowledgeBox
        state={ackState()}
        viewer="employee"
        acknowledge={acknowledge}
      />,
    );
    expect(
      screen.getByText("Podés acusar recibo hasta el 17 mar 2026."),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Nota (opcional)"), "  Gracias  ");
    await user.click(screen.getByRole("button", { name: "Acusar recibo" }));
    await waitFor(() =>
      expect(acknowledge).toHaveBeenCalledWith(PART, "Gracias"),
    );
  });

  it("sends no note when the field is empty", async () => {
    const user = userEvent.setup();
    const acknowledge = vi.fn(async () => ({ ok: true as const }));
    renderIn(
      "es",
      <AcknowledgeBox
        state={ackState()}
        viewer="employee"
        acknowledge={acknowledge}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Acusar recibo" }));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith(PART, null));
  });

  it("shows the error when acknowledging fails", async () => {
    const user = userEvent.setup();
    const acknowledge = vi.fn(async () => ({
      ok: false as const,
      code: "window_closed",
      issues: [],
    }));
    renderIn(
      "es",
      <AcknowledgeBox
        state={ackState()}
        viewer="employee"
        acknowledge={acknowledge}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Acusar recibo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El plazo para acusar recibo venció.",
    );
  });

  it("shows the confirmation, date and note once acknowledged, with no form", () => {
    renderIn(
      "es",
      <AcknowledgeBox
        state={ackState({
          status: "acknowledged",
          acknowledgedAt: new Date("2026-03-12T10:00:00Z"),
          note: "Lo leí",
        })}
        viewer="employee"
        acknowledge={vi.fn()}
      />,
    );
    expect(screen.getByText("Acusaste recibo el 12 mar 2026.")).toBeVisible();
    expect(screen.getByText("Tu nota: Lo leí")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("says the window ended when it expired", () => {
    renderIn(
      "en",
      <AcknowledgeBox
        state={ackState({ status: "expired" })}
        viewer="employee"
        acknowledge={vi.fn()}
      />,
    );
    expect(
      screen.getByText("The time to acknowledge ended on Mar 17, 2026."),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("waits for the manager to share", () => {
    renderIn(
      "es",
      <AcknowledgeBox
        state={ackState({ status: "not_shared", deadline: null })}
        viewer="employee"
        acknowledge={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Podrás acusar recibo cuando tu manager comparta la evaluación.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("the manager sees the status read-only", () => {
    const { rerender } = renderIn(
      "es",
      <AcknowledgeBox state={ackState()} viewer="manager" />,
    );
    expect(
      screen.getByText("El empleado puede acusar recibo hasta el 17 mar 2026."),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
        <AcknowledgeBox
          viewer="manager"
          state={ackState({
            status: "acknowledged",
            acknowledgedAt: new Date("2026-03-12T10:00:00Z"),
            note: "Entendido",
          })}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText("El empleado acusó recibo el 12 mar 2026."),
    ).toBeVisible();
    expect(screen.getByText("Nota del empleado: Entendido")).toBeVisible();
  });
});
