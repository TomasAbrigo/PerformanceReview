import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { CreateCycleForm } from "./create-cycle-form";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

const defaults = {
  name: "Evaluación semestral 2025-03-29 – 2025-09-28",
  periodStart: "2025-03-29",
  periodEnd: "2025-09-28",
};

function renderIn(
  locale: "es" | "en",
  create = vi.fn().mockResolvedValue({ ok: true, id: "c1" }),
) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "es" ? es : en}
    >
      <CreateCycleForm defaults={defaults} create={create} />
    </NextIntlClientProvider>,
  );
  return create;
}

describe("CreateCycleForm", () => {
  it("suggests the semester period and the Santex template", () => {
    renderIn("es");
    expect(screen.getByLabelText("Nombre")).toHaveValue(defaults.name);
    expect(screen.getByLabelText("Inicio del período")).toHaveValue(
      "2025-03-29",
    );
    expect(screen.getByLabelText("Fin del período")).toHaveValue("2025-09-28");
    expect(screen.getByLabelText("Template")).toHaveValue(
      "Evaluación semestral Santex",
    );
  });

  it("creates the cycle and goes to its page", async () => {
    const create = renderIn("en");
    await userEvent.click(screen.getByRole("button", { name: "Create cycle" }));
    expect(create).toHaveBeenCalledWith(defaults);
    await vi.waitFor(() =>
      expect(push).toHaveBeenCalledWith("/settings/cycles/c1"),
    );
  });

  it("marks the field the server rejected", async () => {
    renderIn(
      "en",
      vi.fn().mockResolvedValue({
        ok: false,
        code: "validation",
        issues: [{ path: "name", message: "required" }],
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Create cycle" }));
    expect(await screen.findByText("This is required.")).toBeVisible();
  });
});
