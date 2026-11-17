import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import es from "@/messages/es.json";
import { ReapplyButton } from "./reapply-button";

describe("ReapplyButton", () => {
  it("runs the action and says how many answers were remapped", async () => {
    const action = vi
      .fn()
      .mockResolvedValue({ ok: true, remapped: 2, resolved: 1 });
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        <ReapplyButton action={action} />
      </NextIntlClientProvider>,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Reaplicar equivalencias" }));
    expect(action).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 respuestas remapeadas.",
    );
  });
});
