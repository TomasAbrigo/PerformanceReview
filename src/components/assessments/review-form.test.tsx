import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { type FormQuestion, ReviewForm } from "./review-form";

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

const questions: FormQuestion[] = [
  {
    id: "q1",
    section: "Autoevaluación",
    prompt: "¿Qué hago bien?",
    kind: "text",
    required: true,
    options: [],
  },
  {
    id: "q2",
    section: "Autoevaluación",
    prompt: "Compromiso",
    kind: "rating",
    required: true,
    options: [
      { value: "1", label: "Bajo" },
      { value: "2", label: "Alto" },
    ],
  },
  {
    id: "q3",
    section: "Custom",
    prompt: "Opcional",
    kind: "text",
    required: false,
    options: [],
  },
];

const ok = () => vi.fn().mockResolvedValue({ ok: true });

describe("ReviewForm", () => {
  it("saves a draft with what was typed, required or not", async () => {
    const save = ok();
    const submit = ok();
    renderIn(
      "es",
      <ReviewForm
        questions={questions}
        initial={{ q3: "Antes" }}
        readOnly={false}
        save={save}
        submit={submit}
      />,
    );
    fireEvent.change(screen.getByLabelText(/¿Qué hago bien\?/), {
      target: { value: "Mucho" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith([
      { questionRevisionId: "q1", value: "Mucho" },
      { questionRevisionId: "q2", value: null },
      { questionRevisionId: "q3", value: "Antes" },
    ]);
    expect(submit).not.toHaveBeenCalled();
    expect(await screen.findByText("Borrador guardado.")).toBeTruthy();
  });

  it("does not submit while a required answer is missing, and marks it", async () => {
    const submit = ok();
    renderIn(
      "es",
      <ReviewForm
        questions={questions}
        initial={{ q1: "Mucho" }}
        readOnly={false}
        save={ok()}
        submit={submit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(
      await screen.findByText("Esta respuesta es obligatoria."),
    ).toBeTruthy();
    expect(screen.getAllByText("Esta respuesta es obligatoria.")).toHaveLength(
      1,
    );
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("2 · Alto"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][0]).toContainEqual({
      questionRevisionId: "q2",
      value: "2",
    });
  });

  it("shows the issues the server sends back next to their question", async () => {
    const submit = vi.fn().mockResolvedValue({
      ok: false,
      code: "validation",
      issues: [{ path: "q1", message: "required" }],
    });
    renderIn(
      "es",
      <ReviewForm
        questions={questions}
        initial={{ q1: "x", q2: "1" }}
        readOnly={false}
        save={ok()}
        submit={submit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(
      await screen.findByText("Esta respuesta es obligatoria."),
    ).toBeTruthy();
  });

  it("is read-only once submitted: no inputs, no buttons", () => {
    renderIn(
      "en",
      <ReviewForm
        questions={questions}
        initial={{ q1: "A lot", q2: "2" }}
        readOnly
        save={ok()}
        submit={ok()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("A lot")).toBeTruthy();
    expect(screen.getByText("2 · Alto")).toBeTruthy();
    expect(screen.getAllByText("No answer")).toHaveLength(1);
  });
});
