import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { type ScaleActions, type ScaleRow, ScalesView } from "./scales-view";

const fourPoint: ScaleRow = {
  id: "s1",
  name: { es: "4 puntos descriptiva", en: "4-point descriptive" },
  isSystem: true,
  options: [
    {
      value: 1,
      normalized: 0,
      label: { es: "Necesita desarrollo", en: "Needs development" },
    },
    {
      value: 4,
      normalized: 1,
      label: { es: "Marca un nuevo estándar", en: "Sets a new standard" },
    },
  ],
};

function actions(overrides: Partial<ScaleActions> = {}): ScaleActions {
  return {
    create: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function renderIn(locale: "es" | "en", scales: ScaleRow[], a = actions()) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "es" ? es : en}
    >
      <ScalesView scales={scales} actions={a} />
    </NextIntlClientProvider>,
  );
}

describe("ScalesView", () => {
  it("shows an empty state", () => {
    renderIn("es", []);
    expect(screen.getByText("Todavía no hay escalas.")).toBeVisible();
  });

  it("lists options with normalized values and no delete for system scales", () => {
    renderIn("en", [fourPoint]);
    expect(screen.getByText("4-point descriptive")).toBeVisible();
    expect(
      screen.getByText("Sets a new standard (4 · normalized 1)"),
    ).toBeVisible();
    expect(screen.getByText("System")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Delete scale" })).toBeNull();
  });

  it("marks a missing option label returned by the server", async () => {
    const create = vi.fn().mockResolvedValue({
      ok: false,
      code: "validation",
      issues: [{ path: "options.1.label.es", message: "required" }],
    });
    renderIn("es", [], actions({ create }));
    const form = screen.getByRole("form", { name: "Nueva escala" });
    await userEvent
      .setup()
      .click(within(form).getByRole("button", { name: "Crear escala" }));
    expect(create).toHaveBeenCalled();
    expect(
      await within(form).findByText("Falta el texto en español."),
    ).toBeVisible();
  });
});
