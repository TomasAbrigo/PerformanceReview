import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  type EditorActions,
  type EditorTemplate,
  TemplateEditor,
} from "./template-editor";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const scales = [{ id: "s1", name: { es: "4 puntos", en: "4-point" } }];

function template(overrides: Partial<EditorTemplate> = {}): EditorTemplate {
  return {
    id: "t1",
    name: { es: "Mi template", en: "My template" },
    description: null,
    isSystem: false,
    sections: [
      {
        id: "sec1",
        title: { es: "Autoevaluación", en: "Self-reflection" },
        questions: [
          {
            id: "q1",
            kind: "rating",
            appliesTo: ["manager"],
            visibleToReviewee: true,
            required: true,
            scaleId: "s1",
            prompt: { es: "Calificación general", en: "Overall rating" },
            choices: null,
            role: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function actions(overrides: Partial<EditorActions> = {}): EditorActions {
  const ok = vi.fn().mockResolvedValue({ ok: true });
  return {
    updateTemplate: ok,
    addSection: ok,
    updateSection: ok,
    deleteSection: ok,
    addQuestion: ok,
    updateQuestion: ok,
    deleteQuestion: ok,
    reorder: ok,
    clone: vi.fn().mockResolvedValue({ ok: true, id: "t2" }),
    ...overrides,
  };
}

function renderIn(
  locale: "es" | "en",
  ui: { template?: EditorTemplate; actions?: EditorActions } = {},
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "es" ? es : en}
    >
      <TemplateEditor
        template={ui.template ?? template()}
        scales={scales}
        actions={ui.actions ?? actions()}
      />
    </NextIntlClientProvider>,
  );
}

describe("TemplateEditor", () => {
  it("shows sections and questions in Spanish", () => {
    renderIn("es");
    expect(
      screen.getByRole("heading", { name: "Autoevaluación" }),
    ).toBeVisible();
    expect(screen.getByText("Calificación general")).toBeVisible();
    expect(screen.getByText("Calificación · 4 puntos")).toBeVisible();
  });

  it("shows sections and questions in English", () => {
    renderIn("en");
    expect(
      screen.getByRole("heading", { name: "Self-reflection" }),
    ).toBeVisible();
    expect(screen.getByText("Overall rating")).toBeVisible();
    expect(screen.getByText("Rating · 4-point")).toBeVisible();
  });

  it("shows an empty state when the template has no sections", () => {
    renderIn("es", { template: template({ sections: [] }) });
    expect(
      screen.getByText("Este template todavía no tiene secciones."),
    ).toBeVisible();
  });

  it("sends a new question with both locales", async () => {
    const addQuestion = vi.fn().mockResolvedValue({ ok: true });
    renderIn("en", { actions: actions({ addQuestion }) });
    const user = userEvent.setup();

    const form = screen.getByRole("form", { name: "New question" });
    await user.type(
      within(form).getByLabelText("Text (Spanish)"),
      "¿Qué aprendiste?",
    );
    await user.type(
      within(form).getByLabelText("Text (English)"),
      "What did you learn?",
    );
    await user.click(within(form).getByLabelText("Self"));
    await user.click(
      within(form).getByRole("button", { name: "Add question" }),
    );

    expect(addQuestion).toHaveBeenCalledWith(
      "sec1",
      expect.objectContaining({
        kind: "text",
        appliesTo: ["self"],
        prompt: { es: "¿Qué aprendiste?", en: "What did you learn?" },
      }),
    );
  });

  it("marks the missing locale reported by the server", async () => {
    const addQuestion = vi.fn().mockResolvedValue({
      ok: false,
      code: "validation",
      issues: [{ path: "prompt.en", message: "required" }],
    });
    renderIn("es", { actions: actions({ addQuestion }) });
    const user = userEvent.setup();

    const form = screen.getByRole("form", { name: "Nueva pregunta" });
    await user.type(within(form).getByLabelText("Texto (español)"), "Hola");
    await user.click(
      within(form).getByRole("button", { name: "Agregar pregunta" }),
    );

    expect(
      await within(form).findByText("Falta el texto en inglés."),
    ).toBeVisible();
    expect(within(form).getByLabelText("Texto (inglés)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("shows a generic error when an action fails", async () => {
    const deleteQuestion = vi
      .fn()
      .mockResolvedValue({ ok: false, code: "not_found", issues: [] });
    renderIn("en", { actions: actions({ deleteQuestion }) });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Delete question" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The item no longer exists.",
    );
  });

  it("sends the special role chosen for a question", async () => {
    const addQuestion = vi.fn().mockResolvedValue({ ok: true });
    renderIn("en", { actions: actions({ addQuestion }) });
    const user = userEvent.setup();
    const form = screen.getByRole("form", { name: "New question" });
    await user.type(within(form).getByLabelText("Text (Spanish)"), "Metas");
    await user.type(within(form).getByLabelText("Text (English)"), "Goals");
    await user.selectOptions(within(form).getByLabelText("Type"), "rating");
    await user.selectOptions(within(form).getByLabelText("Scale"), "4-point");
    await user.selectOptions(
      within(form).getByLabelText("Special role"),
      "Goals rating",
    );
    await user.click(within(form).getByLabelText("Manager"));
    await user.click(
      within(form).getByRole("button", { name: "Add question" }),
    );
    expect(addQuestion).toHaveBeenCalledWith(
      "sec1",
      expect.objectContaining({ kind: "rating", role: "goals_rating" }),
    );
  });

  it("offers only the roles that fit the question type", async () => {
    renderIn("es");
    const user = userEvent.setup();
    const form = screen.getByRole("form", { name: "Nueva pregunta" });
    const roles = () =>
      within(within(form).getByLabelText("Función especial"))
        .getAllByRole("option")
        .map((o) => o.textContent);
    expect(roles()).toEqual(["Ninguna", "Comentario de objetivos"]);
    await user.selectOptions(within(form).getByLabelText("Tipo"), "rating");
    expect(roles()).toEqual([
      "Ninguna",
      "Calificación de objetivos",
      "Calificación general de desempeño",
    ]);
    await user.selectOptions(
      within(form).getByLabelText("Función especial"),
      "Calificación de objetivos",
    );
    // Changing the type drops a role that no longer fits.
    await user.selectOptions(within(form).getByLabelText("Tipo"), "text");
    expect(within(form).getByLabelText("Función especial")).toHaveValue("");
    await user.selectOptions(
      within(form).getByLabelText("Tipo"),
      "single_choice",
    );
    expect(roles()).toEqual(["Ninguna"]);
  });

  it("shows the role of a question and lets it be cleared", async () => {
    const updateQuestion = vi.fn().mockResolvedValue({ ok: true });
    const marked = template();
    marked.sections[0].questions[0].role = "overall_rating";
    renderIn("es", { template: marked, actions: actions({ updateQuestion }) });
    const user = userEvent.setup();
    expect(screen.getByText("Calificación general de desempeño")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Editar pregunta" }));
    const form = screen.getByRole("form", { name: "Editar pregunta" });
    expect(within(form).getByLabelText("Función especial")).toHaveValue(
      "overall_rating",
    );
    await user.selectOptions(
      within(form).getByLabelText("Función especial"),
      "Ninguna",
    );
    await user.click(
      within(form).getByRole("button", { name: "Guardar pregunta" }),
    );
    expect(updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ role: null }),
    );
  });

  it("explains that a template already has that role", async () => {
    const addQuestion = vi.fn().mockResolvedValue({
      ok: false,
      code: "validation",
      issues: [{ path: "role", message: "duplicate_role" }],
    });
    renderIn("es", { actions: actions({ addQuestion }) });
    const user = userEvent.setup();
    const form = screen.getByRole("form", { name: "Nueva pregunta" });
    await user.click(
      within(form).getByRole("button", { name: "Agregar pregunta" }),
    );
    expect(
      await within(form).findByText(
        "Este template ya tiene una pregunta con esa función.",
      ),
    ).toBeVisible();
  });

  it("renders system templates read-only with a clone button", () => {
    renderIn("es", { template: template({ isSystem: true }) });
    expect(
      screen.getByText(
        "Este es un template del sistema: no se puede editar ni borrar, solo clonar.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Clonar" })).toBeVisible();
    expect(screen.queryByRole("form", { name: "Nueva pregunta" })).toBeNull();
  });
});
