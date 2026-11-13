import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { type CycleDetailData, CycleDetailView } from "./cycle-detail";
import { CycleWizard, type WizardActions } from "./cycle-wizard";
import { CyclesList } from "./cycles-list";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
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

const ANA = "00000000-0000-4000-8000-000000000001";
const BRUNO = "00000000-0000-4000-8000-000000000002";
const TEMPLATE = "00000000-0000-4000-8000-0000000000aa";

// ------------------------------------------------------------------ list

describe("CyclesList", () => {
  it.each([
    ["es", "Ciclos de evaluación", "Recolección"],
    ["en", "Review cycles", "Collecting"],
  ] as const)("lists cycles with status and count in %s", (locale, h, st) => {
    renderIn(
      locale,
      <CyclesList
        cycles={[
          {
            id: "c1",
            name: "H1 2026",
            status: "collecting",
            periodStart: "2026-01-01",
            periodEnd: "2026-06-30",
            participantCount: 12,
          },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: h })).toBeVisible();
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByRole("link", { name: "H1 2026" })).toHaveAttribute(
      "href",
      "/cycles/c1",
    );
    expect(within(row).getByText(st)).toBeVisible();
    expect(within(row).getByText("2026-01-01 → 2026-06-30")).toBeVisible();
    expect(within(row).getByText("12")).toBeVisible();
  });

  it.each([
    ["es", "Todavía no hay ciclos."],
    ["en", "There are no cycles yet."],
  ] as const)("shows the empty state in %s", (locale, empty) => {
    renderIn(locale, <CyclesList cycles={[]} />);
    expect(screen.getByText(empty)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- wizard

const options = {
  departments: ["Ingeniería", "Ventas"],
  divisions: ["Corporativo"],
  locations: ["Córdoba", "Rosario"],
  jobTitles: ["CEO", "Developer"],
  statuses: ["Active", "Inactive"],
  people: [
    { id: ANA, displayName: "Ana García" },
    { id: BRUNO, displayName: "Bruno Pérez" },
  ],
  templates: [{ id: TEMPLATE, name: { es: "Anual", en: "Annual" } }],
  scales: [],
};

let actions: WizardActions;
beforeEach(() => {
  push.mockReset();
  actions = {
    preview: vi.fn().mockImplementation(async (filter) => ({
      ok: true,
      count: filter.kind === "all" ? 2 : 1,
      sample: [
        {
          personId: BRUNO,
          displayName: "Bruno Pérez",
          department: "Ingeniería",
          jobTitle: "Developer",
        },
      ],
    })),
    create: vi.fn().mockResolvedValue({ ok: true, id: "new-cycle" }),
    launch: vi.fn().mockResolvedValue({ ok: true }),
  };
});

async function fillDates(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Cycle name"), "H1 2026");
  await user.type(screen.getByLabelText("Period start"), "2026-01-01");
  await user.type(screen.getByLabelText("Period end"), "2026-06-30");
  await user.type(screen.getByLabelText("Org snapshot date"), "2026-06-01");
}

describe("CycleWizard", () => {
  it("shows the participant count of the filter on the people step (es)", async () => {
    const user = userEvent.setup();
    renderIn("es", <CycleWizard options={options} actions={actions} />);
    expect(screen.getByText("Paso 1 de 4")).toBeVisible();
    expect(await screen.findByText("2 personas coinciden")).toBeVisible();

    await user.click(screen.getByLabelText("Por filtro"));
    await user.click(screen.getByRole("checkbox", { name: "Rosario" }));
    await waitFor(() =>
      expect(actions.preview).toHaveBeenLastCalledWith({
        kind: "filter",
        departments: [],
        divisions: [],
        locations: ["Rosario"],
        jobTitles: [],
        statuses: [],
      }),
    );
    expect(await screen.findByText("1 persona coincide")).toBeVisible();
    expect(screen.getByText("Bruno Pérez")).toBeVisible();
  });

  it("offers anonymity modes only for enabled components", async () => {
    const user = userEvent.setup();
    renderIn("en", <CycleWizard options={options} actions={actions} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 4")).toBeVisible();
    expect(screen.getByLabelText("Peer anonymity")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Peer review" }));
    expect(screen.queryByLabelText("Peer anonymity")).not.toBeInTheDocument();
  });

  it("validates that phase dates are in order", async () => {
    const user = userEvent.setup();
    renderIn("en", <CycleWizard options={options} actions={actions} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await fillDates(user);
    await user.type(screen.getByLabelText("Self review"), "2026-07-15");
    await user.type(screen.getByLabelText("Manager"), "2026-07-01");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Dates must be in order.")).toBeVisible();
    expect(screen.getByText("Step 3 of 4")).toBeVisible();
  });

  it("creates and launches the cycle from the review step (en)", async () => {
    const user = userEvent.setup();
    renderIn("en", <CycleWizard options={options} actions={actions} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await fillDates(user);
    await user.type(screen.getByLabelText("Self review"), "2026-07-01");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Step 4 of 4")).toBeVisible();
    expect(
      await screen.findByText("Will launch with 2 participants"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create and launch" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/cycles/new-cycle"));
    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "H1 2026",
        periodStart: "2026-01-01",
        periodEnd: "2026-06-30",
        snapshotDate: "2026-06-01",
        templateId: TEMPLATE,
        dueDates: { self: "2026-07-01" },
        participantFilter: { kind: "all" },
      }),
    );
    expect(actions.launch).toHaveBeenCalledWith("new-cycle");
  });
});

// ---------------------------------------------------------------- detail

const detail: CycleDetailData = {
  id: "c1",
  name: "H1 2026",
  status: "nominations",
  periodStart: "2026-01-01",
  periodEnd: "2026-06-30",
  snapshotDate: "2026-06-01",
  questionCount: 5,
  stats: { active: 2, removed: 0, withoutManager: 1 },
  allowedTransitions: ["collecting"],
  participants: [
    {
      id: "p1",
      displayName: "Ana García",
      snapManagerName: null,
      snapDepartment: "Dirección",
      snapJobTitle: "CEO",
      withoutManager: true,
      removedAt: null,
    },
    {
      id: "p2",
      displayName: "Bruno Pérez",
      snapManagerName: "Carla Romero",
      snapDepartment: "Ingeniería",
      snapJobTitle: "Developer",
      withoutManager: false,
      removedAt: null,
    },
  ],
  transitions: [
    {
      id: "t1",
      fromStatus: "draft",
      toStatus: "nominations",
      actorName: null,
      note: null,
      createdAt: new Date("2026-06-02T10:00:00Z"),
    },
  ],
};

describe("CycleDetailView", () => {
  it.each([
    ["es", "Nominaciones", "Sin manager", "Borrador", "Sistema"],
    ["en", "Nominations", "No manager", "Draft", "System"],
  ] as const)(
    "shows status, participants with snapshot managers and the log in %s",
    (locale, status, noManager, draft, system) => {
      renderIn(
        locale,
        <CycleDetailView
          cycle={detail}
          actions={{ transition: vi.fn(), launch: vi.fn() }}
        />,
      );
      expect(
        screen.getByRole("heading", { level: 1, name: "H1 2026" }),
      ).toBeVisible();
      expect(screen.getAllByText(status)[0]).toBeVisible();
      const participants = screen.getAllByRole("table")[0];
      const [, anaRow, brunoRow] = within(participants).getAllByRole("row");
      expect(within(anaRow).getByText(noManager)).toBeVisible();
      expect(within(brunoRow).getByText("Carla Romero")).toBeVisible();
      const log = screen.getAllByRole("table")[1];
      expect(within(log).getByText(draft)).toBeVisible();
      expect(within(log).getByText(system)).toBeVisible();
    },
  );

  it("asks for confirmation before changing phase", async () => {
    const user = userEvent.setup();
    const transition = vi.fn().mockResolvedValue({ ok: true });
    renderIn(
      "en",
      <CycleDetailView
        cycle={detail}
        actions={{ transition, launch: vi.fn() }}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Move to Collecting" }),
    );
    expect(transition).not.toHaveBeenCalled();
    expect(
      screen.getByText("The cycle will move from Nominations to Collecting."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(transition).toHaveBeenCalledWith("c1", "collecting"),
    );
  });

  it.each([
    ["es", "Este ciclo todavía no tiene participantes.", "Lanzar ciclo"],
    ["en", "This cycle has no participants yet.", "Launch cycle"],
  ] as const)("shows a draft without participants in %s", (locale, e, l) => {
    renderIn(
      locale,
      <CycleDetailView
        cycle={{
          ...detail,
          status: "draft",
          participants: [],
          transitions: [],
          allowedTransitions: [],
          stats: { active: 0, removed: 0, withoutManager: 0 },
        }}
        actions={{ transition: vi.fn(), launch: vi.fn() }}
      />,
    );
    expect(screen.getByText(e)).toBeVisible();
    expect(screen.getByRole("button", { name: l })).toBeVisible();
  });
});
