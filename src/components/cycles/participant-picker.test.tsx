import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { ParticipantPicker } from "./participant-picker";

const candidates = [
  { personId: "p1", displayName: "Ana", department: "Ops", managerName: null },
  {
    personId: "p2",
    displayName: "Bruno",
    department: "Dev",
    managerName: "Ana",
  },
  {
    personId: "p3",
    displayName: "Carla",
    department: "Dev",
    managerName: "Ana",
  },
];

function renderPicker(initial: string[] = []) {
  const save = vi.fn().mockResolvedValue({ ok: true });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ParticipantPicker
        candidates={candidates}
        initial={initial}
        save={save}
      />
    </NextIntlClientProvider>,
  );
  return save;
}

describe("ParticipantPicker", () => {
  it("starts from the saved participants", () => {
    renderPicker(["p2"]);
    expect(screen.getByRole("checkbox", { name: /^Bruno/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Ana/ })).not.toBeChecked();
    expect(screen.getByText("1 selected")).toBeVisible();
  });

  it("picks every active person at once", async () => {
    const save = renderPicker();
    await userEvent.click(
      screen.getByRole("button", { name: "All active people" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save participants" }),
    );
    expect(save).toHaveBeenCalledWith(["p1", "p2", "p3"]);
  });

  it("adds an area, on top of who was already picked", async () => {
    const save = renderPicker(["p1"]);
    await userEvent.selectOptions(screen.getByLabelText("Add an area"), "Dev");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Save participants" }),
    );
    expect(save).toHaveBeenCalledWith(["p1", "p2", "p3"]);
  });

  it("picks one by one and can clear", async () => {
    const save = renderPicker();
    await userEvent.click(screen.getByRole("checkbox", { name: /^Carla/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Save participants" }),
    );
    expect(save).toHaveBeenCalledWith(["p3"]);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("0 selected")).toBeVisible();
  });
});
