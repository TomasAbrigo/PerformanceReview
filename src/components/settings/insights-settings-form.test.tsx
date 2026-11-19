import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  DEFAULT_SETTINGS,
  type Settings,
} from "@/modules/settings/definitions";
import {
  InsightsSettingsForm,
  type SaveInsightsSettings,
} from "./insights-settings-form";

function renderIn(
  locale: "es" | "en",
  save: SaveInsightsSettings = vi.fn().mockResolvedValue({ ok: true }),
  values: Settings = DEFAULT_SETTINGS,
) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "es" ? es : en}
    >
      <InsightsSettingsForm values={values} save={save} />
    </NextIntlClientProvider>,
  );
  return save;
}

describe("InsightsSettingsForm", () => {
  it("shows the current values of every setting in Spanish", () => {
    renderIn("es");
    const form = screen.getByRole("form", {
      name: "Configuración de insights",
    });
    expect(form).toBeVisible();
    expect(
      screen.getByLabelText("Caída mínima entre ciclos (puntos)"),
    ).toHaveValue(2);
    expect(screen.getByLabelText("Umbral de riesgo")).toHaveValue(2);
    expect(screen.getByLabelText("Tamaño mínimo de grupo (n)")).toHaveValue(5);
    expect(
      screen.getByLabelText("Inicio del primer semestre (MM-DD)"),
    ).toHaveValue("03-29");
    expect(
      screen.getByLabelText("Inicio del segundo semestre (MM-DD)"),
    ).toHaveValue("09-29");
    expect(screen.getByLabelText("Margen de ambigüedad (días)")).toHaveValue(
      15,
    );
    expect(
      screen.getByLabelText("Segmento Alto desde (% del score)"),
    ).toHaveValue(80);
    expect(
      screen.getByLabelText("Segmento Medio desde (% del score)"),
    ).toHaveValue(60);
    expect(
      screen.getByLabelText("Segmento Regular desde (% del score)"),
    ).toHaveValue(40);
    expect(screen.getByLabelText("Proveedor")).toHaveValue("mock");
  });

  it("is available in English", () => {
    renderIn("en");
    expect(
      screen.getByRole("form", { name: "Insights settings" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Minimum group size (n)")).toHaveValue(5);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeVisible();
  });

  it("saves what was edited, with numbers as numbers, and confirms", async () => {
    const user = userEvent.setup();
    const save = renderIn("es");
    const min = screen.getByLabelText("Tamaño mínimo de grupo (n)");
    await user.clear(min);
    await user.type(min, "8");
    const h2 = screen.getByLabelText("Inicio del segundo semestre (MM-DD)");
    await user.clear(h2);
    await user.type(h2, "08-15");
    await user.selectOptions(screen.getByLabelText("Proveedor"), "anthropic");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(save).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      "aggregation.minGroupSize": 8,
      "semester.h2Start": "08-15",
      "analysis.provider": "anthropic",
    });
    expect(await screen.findByText("Cambios guardados.")).toBeVisible();
  });

  it("sends an emptied number as null so the server rejects it", async () => {
    const user = userEvent.setup();
    const save = renderIn("es");
    await user.clear(screen.getByLabelText("Umbral de riesgo"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ "alerts.riskThreshold": null }),
    );
  });

  it("marks the field the server rejected, with its range", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({
      ok: false,
      code: "validation",
      issues: [{ path: "aggregation.minGroupSize", message: "out_of_range" }],
    });
    renderIn("es", save);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Debe estar entre 2 y 100.")).toBeVisible();
    expect(screen.getByLabelText("Tamaño mínimo de grupo (n)")).toBeInvalid();
    expect(screen.queryByText("Cambios guardados.")).toBeNull();
  });

  it("marks the semester order error on the second semester", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({
      ok: false,
      code: "validation",
      issues: [{ path: "semester.h2Start", message: "semester_order" }],
    });
    renderIn("en", save);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(
        "The second semester must start after the first.",
      ),
    ).toBeVisible();
    expect(
      screen.getByLabelText("Second semester starts (MM-DD)"),
    ).toBeInvalid();
  });

  it("says so when the actor may not save", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValue({ ok: false, code: "forbidden", issues: [] });
    renderIn("es", save);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(
      await screen.findByText("No tenés permiso para hacer esto."),
    ).toBeVisible();
  });
});
