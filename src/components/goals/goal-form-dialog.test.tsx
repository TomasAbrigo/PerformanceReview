import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import { GoalFormDialog, type SaveGoal } from "./goal-form-dialog";

const owners = [
  { id: "me", name: "Dora Díaz" },
  { id: "eli", name: "Eli Roca" },
];

function renderDialog(
  props: Partial<React.ComponentProps<typeof GoalFormDialog>> & {
    save: SaveGoal;
  },
) {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <GoalFormDialog mode="create" {...props} />
    </NextIntlClientProvider>,
  );
}

const open = (name = "New goal") =>
  userEvent.click(screen.getByRole("button", { name }));
const dialog = () => screen.getByRole("dialog");

describe("GoalFormDialog", () => {
  it("creates a goal with a title, description and due date", async () => {
    const save = vi.fn<SaveGoal>().mockResolvedValue({ ok: true });
    renderDialog({ save });
    await open();
    const form = within(dialog());
    await userEvent.type(form.getByLabelText("Title"), "Cerrar el release");
    await userEvent.type(form.getByLabelText("Description"), "Con QA");
    await userEvent.type(form.getByLabelText("Due date"), "2026-12-31");
    await userEvent.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        personId: undefined,
        title: "Cerrar el release",
        description: "Con QA",
        dueDate: "2026-12-31",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers the owner only when the actor may pick more than themself", async () => {
    const save = vi.fn<SaveGoal>().mockResolvedValue({ ok: true });
    renderDialog({ save, owners: owners.slice(0, 1) });
    await open();
    expect(within(dialog()).queryByLabelText("Person")).toBeNull();
  });

  it("creates the goal for the person picked", async () => {
    const save = vi.fn<SaveGoal>().mockResolvedValue({ ok: true });
    renderDialog({ save, owners });
    await open();
    const form = within(dialog());
    await userEvent.selectOptions(form.getByLabelText("Person"), "eli");
    await userEvent.type(form.getByLabelText("Title"), "Para Eli");
    await userEvent.click(form.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ personId: "eli", title: "Para Eli" }),
      ),
    );
  });

  it("shows what the server refused, next to the field, and stays open", async () => {
    const save = vi.fn<SaveGoal>().mockResolvedValue({
      ok: false,
      code: "validation",
      issues: [{ path: "title", message: "required" }],
    });
    renderDialog({ save });
    await open();
    await userEvent.click(
      within(dialog()).getByRole("button", { name: "Save" }),
    );
    expect(
      await within(dialog()).findByText("This field is required."),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("edits with the goal's own values and forgets what was typed when cancelled", async () => {
    const save = vi.fn<SaveGoal>().mockResolvedValue({ ok: true });
    renderDialog({
      mode: "edit",
      save,
      initial: { title: "Original", description: "", dueDate: "2026-12-31" },
    });
    await open("Edit");
    const title = () =>
      within(dialog()).getByLabelText("Title") as HTMLInputElement;
    expect(title().value).toBe("Original");
    await userEvent.type(title(), " cambiado");
    await userEvent.click(
      within(dialog()).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await open("Edit");
    expect(title().value).toBe("Original");
    expect(save).not.toHaveBeenCalled();
  });
});
