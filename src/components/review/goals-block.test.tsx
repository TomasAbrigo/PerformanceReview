import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { GoalsBlockData } from "@/modules/review-core/goal-snapshot";
import { GoalsBlock, type GoalsBlockActions } from "./goals-block";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const messages = { es, en };
function renderIn(locale: "es" | "en", ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const PART = "00000000-0000-4000-8000-0000000000b1";

function data(overrides: Partial<GoalsBlockData> = {}): GoalsBlockData {
  return {
    participantId: PART,
    goals: [
      {
        id: "s1",
        title: "Reducir el tiempo de respuesta",
        status: "in_progress",
        percentComplete: 55,
        dueDate: "2026-12-15",
        noLongerApplicable: false,
      },
      {
        id: "s2",
        title: "Obtener la certificación",
        status: "completed",
        percentComplete: 100,
        dueDate: null,
        noLongerApplicable: false,
      },
    ],
    asOf: "2026-01-10",
    canRefresh: false,
    canLink: false,
    linkable: [],
    ...overrides,
  };
}

const actions = (): GoalsBlockActions => ({
  refresh: vi.fn().mockResolvedValue({ ok: true }),
  link: vi.fn().mockResolvedValue({ ok: true }),
});

describe("GoalsBlock", () => {
  it("lists the goals with status, progress, due date and the legend (es)", () => {
    renderIn("es", <GoalsBlock data={data()} />);
    expect(
      screen.getByRole("heading", { name: "Objetivos del período" }),
    ).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const first = within(items[0]);
    expect(first.getByText("Reducir el tiempo de respuesta")).toBeVisible();
    expect(first.getByText("En curso")).toBeVisible();
    expect(first.getByText("Vence 15 dic 2026")).toBeVisible();
    expect(first.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "55",
    );
    expect(first.getByText("55%")).toBeVisible();
    const second = within(items[1]);
    expect(second.getByText("Completado")).toBeVisible();
    expect(second.getByText("Sin fecha límite")).toBeVisible();
    expect(screen.getByText("Progreso al 10 ene 2026")).toBeVisible();
    expect(screen.queryByText("Ya no aplica")).not.toBeInTheDocument();
  });

  it("renders in English", () => {
    renderIn("en", <GoalsBlock data={data()} />);
    expect(
      screen.getByRole("heading", { name: "Goals for the period" }),
    ).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeVisible();
    expect(screen.getByText("Due Dec 15, 2026")).toBeVisible();
    expect(screen.getByText("No due date")).toBeVisible();
    expect(screen.getByText("Progress as of Jan 10, 2026")).toBeVisible();
  });

  it.each([
    ["es", "No hay objetivos en este período"],
    ["en", "There are no goals in this period"],
  ] as const)("says so when there are no goals (%s)", (locale, text) => {
    renderIn(
      locale,
      <GoalsBlock
        data={data({ goals: [], asOf: null, canRefresh: false })}
        actions={actions()}
      />,
    );
    expect(screen.getByText(new RegExp(text))).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/Progreso al|Progress as of/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["es", "Ya no aplica"],
    ["en", "No longer applicable"],
  ] as const)("flags a deleted goal (%s)", (locale, badge) => {
    const base = data();
    renderIn(
      locale,
      <GoalsBlock
        data={{
          ...base,
          goals: [
            { ...base.goals[0], noLongerApplicable: true },
            base.goals[1],
          ],
        }}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText(badge)).toBeVisible();
    expect(within(items[1]).queryByText(badge)).toBeNull();
  });

  it("refreshes the progress for whoever may", async () => {
    const user = userEvent.setup();
    const acts = actions();
    renderIn(
      "es",
      <GoalsBlock data={data({ canRefresh: true })} actions={acts} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Actualizar progreso" }),
    );
    await waitFor(() => expect(acts.refresh).toHaveBeenCalledWith(PART));
  });

  it("hides the refresh button without permission or actions", () => {
    const { unmount } = renderIn(
      "es",
      <GoalsBlock data={data({ canRefresh: false })} actions={actions()} />,
    );
    expect(
      screen.queryByRole("button", { name: "Actualizar progreso" }),
    ).toBeNull();
    unmount();
    renderIn("es", <GoalsBlock data={data({ canRefresh: true })} />);
    expect(
      screen.queryByRole("button", { name: "Actualizar progreso" }),
    ).toBeNull();
  });

  it("shows the error when the refresh fails", async () => {
    const user = userEvent.setup();
    const acts = actions();
    vi.mocked(acts.refresh).mockResolvedValue({
      ok: false,
      code: "forbidden",
      issues: [],
    });
    renderIn(
      "es",
      <GoalsBlock data={data({ canRefresh: true })} actions={acts} />,
    );
    await user.click(
      screen.getByRole("button", { name: "Actualizar progreso" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permiso para esta acción.",
    );
  });

  it("lets HR link one of the owner's other goals", async () => {
    const user = userEvent.setup();
    const acts = actions();
    renderIn(
      "es",
      <GoalsBlock
        data={data({
          canLink: true,
          linkable: [
            { id: "g1", title: "Goal viejo" },
            { id: "g2", title: "Goal de otro año" },
          ],
        })}
        actions={acts}
      />,
    );
    const button = screen.getByRole("button", { name: "Vincular objetivo" });
    expect(button).toBeDisabled();
    await user.selectOptions(
      screen.getByLabelText("Objetivo a vincular"),
      "Goal de otro año",
    );
    await user.click(button);
    await waitFor(() => expect(acts.link).toHaveBeenCalledWith("g2"));
  });

  it("does not offer linking when there is nothing to link or no right to", () => {
    const { unmount } = renderIn(
      "es",
      <GoalsBlock
        data={data({ canLink: true, linkable: [] })}
        actions={actions()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Vincular objetivo" }),
    ).toBeNull();
    unmount();
    renderIn(
      "es",
      <GoalsBlock
        data={data({ canLink: false, linkable: [{ id: "g1", title: "X" }] })}
        actions={actions()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Vincular objetivo" }),
    ).toBeNull();
  });
});
