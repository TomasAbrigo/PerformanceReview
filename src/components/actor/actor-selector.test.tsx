import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { ActorContext } from "@/modules/actor/types";
import { ActorSelector } from "./actor-selector";

const ANA = "00000000-0000-4000-8000-000000000001";
const people = [{ id: ANA, displayName: "Ana García" }];

function renderIn(
  locale: "es" | "en",
  actor: ActorContext,
  setActor = vi.fn().mockResolvedValue({ ok: true }),
) {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "es" ? es : en}
    >
      <ActorSelector
        actor={actor}
        actorName={null}
        people={people}
        setActor={setActor}
      />
    </NextIntlClientProvider>,
  );
  return setActor;
}

describe("ActorSelector", () => {
  it("offers direction as a role in both languages", () => {
    renderIn("es", { personId: null, role: "hr" });
    expect(screen.getByRole("option", { name: "Dirección" })).toBeVisible();
  });

  it("offers Direction in English", () => {
    renderIn("en", { personId: null, role: "hr" });
    expect(screen.getByRole("option", { name: "Direction" })).toBeVisible();
  });

  it("direction acts without a person: the person select is disabled and null is sent", async () => {
    const user = userEvent.setup();
    const setActor = renderIn("es", { personId: ANA, role: "manager" });
    await user.selectOptions(screen.getByLabelText("Rol"), "direction");
    expect(screen.getByLabelText("Persona")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(setActor).toHaveBeenCalledWith(null, "direction");
  });

  it("shows who the app acts as when it is direction", () => {
    renderIn("es", { personId: null, role: "direction" });
    expect(screen.getByText("Actuando como: Dirección")).toBeVisible();
  });
});
