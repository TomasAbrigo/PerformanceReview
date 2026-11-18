import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { GoalControls } from "./goal-controls";

const ok = { ok: true } as const;
const actions = () => ({
  setProgress: vi.fn().mockResolvedValue(ok),
  setStatus: vi.fn().mockResolvedValue(ok),
  addMilestone: vi.fn().mockResolvedValue(ok),
});
const renderControls = (
  status: "in_progress" | "completed" | "closed",
  a = actions(),
) => {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <GoalControls status={status} percent={20} actions={a} />
    </NextIntlClientProvider>,
  );
  return a;
};

describe("GoalControls", () => {
  it("completes or closes an in-progress goal", async () => {
    const a = renderControls("in_progress");
    await userEvent.click(
      screen.getByRole("button", { name: "Mark as completed" }),
    );
    await waitFor(() => expect(a.setStatus).toHaveBeenCalledWith("completed"));
    await userEvent.click(screen.getByRole("button", { name: "Close goal" }));
    await waitFor(() => expect(a.setStatus).toHaveBeenCalledWith("closed"));
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });

  it("reopens a finished goal", async () => {
    const a = renderControls("closed");
    expect(screen.queryByRole("button", { name: "Close goal" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() =>
      expect(a.setStatus).toHaveBeenCalledWith("in_progress"),
    );
  });

  it("saves a valid progress and refuses an invalid one", async () => {
    const a = renderControls("in_progress");
    const input = screen.getByLabelText("Progress (%)");
    await userEvent.clear(input);
    await userEvent.type(input, "150");
    expect(screen.getByText(/whole number from 0 to 100/)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Save progress" }),
    );
    expect(a.setProgress).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, "75");
    await userEvent.click(
      screen.getByRole("button", { name: "Save progress" }),
    );
    await waitFor(() => expect(a.setProgress).toHaveBeenCalledWith(75));
  });

  it("adds a milestone and clears the field", async () => {
    const a = renderControls("in_progress");
    await userEvent.type(screen.getByLabelText("Add a milestone"), "Paso 1");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(a.addMilestone).toHaveBeenCalledWith("Paso 1"));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Add a milestone") as HTMLInputElement).value,
      ).toBe(""),
    );
  });
});
