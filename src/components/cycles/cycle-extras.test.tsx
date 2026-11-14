import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { HireDateSchedule } from "@/modules/review-core/status";
import { type CycleDetailData, CycleDetailView } from "./cycle-detail";
import { CycleWizard, type WizardActions } from "./cycle-wizard";
import { DuplicateButton } from "./duplicate-button";
import {
  type GroupDraft,
  GroupTemplates,
  type GroupsPreviewData,
} from "./group-templates";
import { HireDateScheduleFields } from "./hire-date-schedule";

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
const ANNUAL = "00000000-0000-4000-8000-0000000000aa";
const SALES = "00000000-0000-4000-8000-0000000000bb";

beforeEach(() => push.mockReset());

// ------------------------------------------------------------- duplicate

describe("DuplicateButton", () => {
  it.each([
    ["es", "Duplicar ciclo", "Copia"],
    ["en", "Duplicate cycle", "Copy"],
  ] as const)(
    "duplicates with the %s suffix and opens the new draft",
    async (locale, label, suffix) => {
      const user = userEvent.setup();
      const duplicate = vi
        .fn()
        .mockResolvedValue({ ok: true, id: "copy-1", warnings: [] });
      renderIn(locale, <DuplicateButton cycleId="c1" duplicate={duplicate} />);
      await user.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/cycles/copy-1"));
      expect(duplicate).toHaveBeenCalledWith("c1", suffix);
    },
  );

  it.each([
    [
      "es",
      "Duplicar ciclo",
      "La plantilla del ciclo ya no está disponible: la copia quedó sin plantilla.",
      "El grupo “Ventas” se omitió: su plantilla ya no está disponible.",
      "Abrir la copia",
    ],
    [
      "en",
      "Duplicate cycle",
      "The cycle's template is no longer available: the copy has no template.",
      "The group “Ventas” was left out: its template is no longer available.",
      "Open the copy",
    ],
  ] as const)(
    "stops to tell what could not be copied before opening the draft (%s)",
    async (locale, label, template, group, open) => {
      const user = userEvent.setup();
      const duplicate = vi.fn().mockResolvedValue({
        ok: true,
        id: "copy-2",
        warnings: [{ kind: "template" }, { kind: "group", name: "Ventas" }],
      });
      renderIn(locale, <DuplicateButton cycleId="c1" duplicate={duplicate} />);
      await user.click(screen.getByRole("button", { name: label }));
      expect(await screen.findByText(template)).toBeVisible();
      expect(screen.getByText(group)).toBeVisible();
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByRole("link", { name: open })).toHaveAttribute(
        "href",
        "/cycles/copy-2",
      );
    },
  );

  it("shows the error and stays when the cycle is gone", async () => {
    const user = userEvent.setup();
    const duplicate = vi
      .fn()
      .mockResolvedValue({ ok: false, code: "not_found", issues: [] });
    renderIn("en", <DuplicateButton cycleId="c1" duplicate={duplicate} />);
    await user.click(screen.getByRole("button", { name: "Duplicate cycle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The cycle no longer exists.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------- hire date

describe("HireDateScheduleFields", () => {
  const value: HireDateSchedule = { milestoneDays: 30, windowWeeks: 2 };
  const sample = { displayName: "Dana Ruiz", hireDate: "2026-01-31" };

  it.each([
    [
      "es",
      "Hito",
      "Ventana",
      "6 meses (180 días)",
      "Dana Ruiz, ingresó el 2026-01-31",
      "Cumple el hito el 2026-03-02",
      "Fecha límite de autoevaluación y manager: 2026-03-16",
    ],
    [
      "en",
      "Milestone",
      "Window",
      "6 months (180 days)",
      "Dana Ruiz, hired on 2026-01-31",
      "Reaches the milestone on 2026-03-02",
      "Self and manager review due on 2026-03-16",
    ],
  ] as const)(
    "offers the milestones and previews the dates of a recent hire in %s",
    (locale, milestone, window, sixMonths, who, reaches, due) => {
      renderIn(
        locale,
        <HireDateScheduleFields
          value={value}
          onChange={vi.fn()}
          sample={sample}
        />,
      );
      const milestones = screen.getByLabelText(milestone);
      expect(
        within(milestones)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toHaveLength(5);
      expect(
        within(milestones).getByRole("option", { name: sixMonths }),
      ).toBeVisible();
      expect(milestones).toHaveValue("30");
      expect(screen.getByLabelText(window)).toHaveValue("2");
      // Jan 31 + 30 days is Mar 2 (February is short), then 2 weeks.
      expect(screen.getByText(who)).toBeVisible();
      expect(screen.getByText(reaches)).toBeVisible();
      expect(screen.getByText(due)).toBeVisible();
    },
  );

  it("reports the milestone and window the user picks", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderIn(
      "en",
      <HireDateScheduleFields
        value={value}
        onChange={onChange}
        sample={sample}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Milestone"), "365");
    expect(onChange).toHaveBeenLastCalledWith({
      milestoneDays: 365,
      windowWeeks: 2,
    });
    await user.selectOptions(screen.getByLabelText("Window"), "4");
    expect(onChange).toHaveBeenLastCalledWith({
      milestoneDays: 30,
      windowWeeks: 4,
    });
  });

  it("updates the preview with the schedule, across a leap day", () => {
    renderIn(
      "en",
      <HireDateScheduleFields
        value={{ milestoneDays: 365, windowWeeks: 1 }}
        onChange={vi.fn()}
        sample={{ displayName: "Lea", hireDate: "2023-03-01" }}
      />,
    );
    expect(
      screen.getByText("Reaches the milestone on 2024-02-29"),
    ).toBeVisible();
    expect(
      screen.getByText("Self and manager review due on 2024-03-07"),
    ).toBeVisible();
  });

  it.each([
    ["es", "No hay ingresos para mostrar de ejemplo."],
    ["en", "There are no hires to show as an example."],
  ] as const)(
    "explains when there is nobody to preview (%s)",
    (locale, text) => {
      renderIn(
        locale,
        <HireDateScheduleFields
          value={value}
          onChange={vi.fn()}
          sample={null}
        />,
      );
      expect(screen.getByText(text)).toBeVisible();
    },
  );
});

// ---------------------------------------------------------------- groups

const groupOptions = {
  departments: ["Ingeniería", "Ventas"],
  divisions: ["Corporativo"],
  locations: ["Córdoba", "Rosario"],
  jobTitles: ["CEO", "Developer"],
  templates: [
    { id: ANNUAL, name: { es: "Anual", en: "Annual" } },
    { id: SALES, name: { es: "Ventas", en: "Sales" } },
  ],
};

const engineering: GroupDraft = {
  key: "g1",
  name: "Engineering",
  templateId: ANNUAL,
  criteria: {
    departments: ["Ingeniería"],
    divisions: [],
    locations: [],
    jobTitles: [],
  },
};
const sales: GroupDraft = {
  key: "g2",
  name: "Sales",
  templateId: SALES,
  criteria: {
    departments: ["Ventas"],
    divisions: [],
    locations: [],
    jobTitles: [],
  },
};

/** Keeps the drafts in state like the wizard does. */
function Harness({
  initial = [],
  preview = null,
  issues = {},
  onChange,
}: {
  initial?: GroupDraft[];
  preview?: GroupsPreviewData | null;
  issues?: Record<string, string>;
  onChange?: (groups: GroupDraft[]) => void;
}) {
  const [groups, setGroups] = useState(initial);
  return (
    <GroupTemplates
      groups={groups}
      onChange={(next) => {
        setGroups(next);
        onChange?.(next);
      }}
      options={groupOptions}
      preview={preview}
      issues={issues}
    />
  );
}

describe("GroupTemplates", () => {
  it.each([
    [
      "es",
      "Todavía no hay grupos: todas las personas usan la plantilla del ciclo.",
      "Agregar grupo",
    ],
    [
      "en",
      "There are no groups yet: everyone uses the cycle's template.",
      "Add group",
    ],
  ] as const)("shows the empty state in %s", async (locale, empty, add) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderIn(locale, <Harness onChange={onChange} />);
    expect(screen.getByText(empty)).toBeVisible();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: add }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "",
        templateId: "",
        criteria: {
          departments: [],
          divisions: [],
          locations: [],
          jobTitles: [],
        },
      }),
    ]);
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });

  it.each([
    [
      "es",
      "2 personas",
      "1 persona",
      "3 personas sin grupo usan la plantilla del ciclo",
    ],
    [
      "en",
      "2 people",
      "1 person",
      "3 people without a group use the cycle's template",
    ],
  ] as const)(
    "shows how many people each group gets and who is left over (%s)",
    (locale, two, one, remainder) => {
      renderIn(
        locale,
        <Harness
          initial={[engineering, sales]}
          preview={{ groups: [2, 1], remainder: 3 }}
        />,
      );
      const [first, second] = screen.getAllByRole("group");
      expect(within(first).getByText(two)).toBeVisible();
      expect(within(second).getByText(one)).toBeVisible();
      expect(screen.getByText(remainder)).toBeVisible();
    },
  );

  it("shows counting while the preview is not ready", () => {
    renderIn("en", <Harness initial={[engineering]} preview={null} />);
    expect(
      within(screen.getByRole("group")).getByText("Counting…"),
    ).toBeVisible();
  });

  it("edits the name, template and criteria of a group", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderIn("en", <Harness initial={[engineering]} onChange={onChange} />);
    const group = within(screen.getByRole("group"));
    expect(group.getByLabelText("Group name")).toHaveValue("Engineering");
    expect(group.getByLabelText("Group template")).toHaveValue(ANNUAL);
    expect(group.getByRole("checkbox", { name: "Ingeniería" })).toBeChecked();

    await user.type(group.getByLabelText("Group name"), "!");
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: "Engineering!" }),
    ]);
    await user.selectOptions(group.getByLabelText("Group template"), SALES);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ templateId: SALES }),
    ]);
    await user.click(group.getByRole("checkbox", { name: "Rosario" }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        criteria: expect.objectContaining({
          departments: ["Ingeniería"],
          locations: ["Rosario"],
        }),
      }),
    ]);
    await user.click(group.getByRole("checkbox", { name: "Ingeniería" }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        criteria: expect.objectContaining({ departments: [] }),
      }),
    ]);
  });

  it("explains that a group without criteria takes whoever is left", () => {
    renderIn(
      "en",
      <Harness
        initial={[
          {
            ...engineering,
            criteria: { ...engineering.criteria, departments: [] },
          },
        ]}
      />,
    );
    expect(
      screen.getByText(
        "No criteria: everyone who is not in an earlier group is in.",
      ),
    ).toBeVisible();
  });

  it("reorders and removes groups: the order is the priority", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderIn(
      "en",
      <Harness initial={[engineering, sales]} onChange={onChange} />,
    );
    const names = () =>
      screen
        .getAllByLabelText("Group name")
        .map((i) => (i as HTMLInputElement).value);
    expect(names()).toEqual(["Engineering", "Sales"]);

    const [first, second] = screen.getAllByRole("group");
    expect(
      within(first).getByRole("button", { name: "Move up" }),
    ).toBeDisabled();
    expect(
      within(second).getByRole("button", { name: "Move down" }),
    ).toBeDisabled();
    await user.click(within(second).getByRole("button", { name: "Move up" }));
    expect(names()).toEqual(["Sales", "Engineering"]);

    await user.click(
      within(screen.getAllByRole("group")[0]).getByRole("button", {
        name: "Remove group",
      }),
    );
    expect(names()).toEqual(["Engineering"]);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ key: "g1" }),
    ]);
  });

  it.each([
    ["es", "Este campo es obligatorio.", "Ya hay un grupo con ese nombre."],
    [
      "en",
      "This field is required.",
      "There is already a group with that name.",
    ],
  ] as const)(
    "shows validation issues per group (%s)",
    (locale, required, dup) => {
      renderIn(
        locale,
        <Harness
          initial={[engineering, sales]}
          issues={{
            "0.name": "required",
            "1.name": "duplicate_name",
            "1.templateId": "required",
          }}
        />,
      );
      const [first, second] = screen.getAllByRole("group");
      expect(within(first).getByText(required)).toBeVisible();
      expect(within(second).getByText(dup)).toBeVisible();
      expect(within(second).getByText(required)).toBeVisible();
    },
  );
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
  templates: [
    { id: ANNUAL, name: { es: "Anual", en: "Annual" } },
    { id: SALES, name: { es: "Ventas", en: "Sales" } },
  ],
  scales: [],
  sampleHire: { displayName: "Dana Ruiz", hireDate: "2026-01-31" },
};

let actions: WizardActions;
beforeEach(() => {
  actions = {
    preview: vi.fn().mockResolvedValue({
      ok: true,
      count: 2,
      sample: [],
    }),
    previewGroups: vi.fn().mockImplementation(async (_filter, groups) => ({
      ok: true,
      total: 2,
      groups: groups.map(() => 1),
      remainder: 1,
    })),
    create: vi.fn().mockResolvedValue({ ok: true, id: "new-cycle" }),
    launch: vi.fn().mockResolvedValue({ ok: true }),
  };
});

function renderWizard() {
  return renderIn(
    "en",
    <CycleWizard
      options={options}
      actions={actions}
      defaultSnapshotDate="2026-06-01"
    />,
  );
}

async function goTo(user: ReturnType<typeof userEvent.setup>, step: number) {
  for (let i = 1; i < step; i++) {
    await user.click(screen.getByRole("button", { name: "Next" }));
  }
}

describe("CycleWizard groups step", () => {
  it("is the optional third step and can be skipped", async () => {
    const user = userEvent.setup();
    renderWizard();
    expect(screen.getByText("Step 1 of 5")).toBeVisible();
    await goTo(user, 3);
    expect(screen.getByText("Step 3 of 5")).toBeVisible();
    expect(screen.getByRole("region", { name: "Groups" })).toBeVisible();
    expect(
      screen.getByText(
        "There are no groups yet: everyone uses the cycle's template.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 4 of 5")).toBeVisible();
  });

  it("previews each group with the cycle's filter and the snapshot date", async () => {
    const user = userEvent.setup();
    renderWizard();
    await goTo(user, 3);
    await user.click(screen.getByRole("button", { name: "Add group" }));
    const group = within(screen.getByRole("group"));
    await user.type(group.getByLabelText("Group name"), "Sales");
    await user.selectOptions(group.getByLabelText("Group template"), SALES);
    await user.click(group.getByRole("checkbox", { name: "Ventas" }));

    await waitFor(() =>
      expect(actions.previewGroups).toHaveBeenLastCalledWith(
        { kind: "all" },
        [
          {
            filter: {
              kind: "filter",
              departments: ["Ventas"],
              divisions: [],
              locations: [],
              jobTitles: [],
            },
          },
        ],
        "2026-06-01",
      ),
    );
    expect(await group.findByText("1 person")).toBeVisible();
    expect(
      screen.getByText("1 person without a group uses the cycle's template"),
    ).toBeVisible();
  });

  it.each([
    ["the request fails", () => Promise.reject(new Error("boom"))],
    [
      "the server answers with an error",
      () => Promise.resolve({ ok: false, code: "validation", issues: [] }),
    ],
  ])(
    "says the counts could not be computed when %s, instead of counting forever",
    async (_case, answer) => {
      const user = userEvent.setup();
      actions.previewGroups = vi.fn().mockImplementation(answer);
      renderWizard();
      await goTo(user, 3);
      await user.click(screen.getByRole("button", { name: "Add group" }));
      expect(
        await screen.findByText("We could not count the people of each group."),
      ).toBeVisible();
      expect(screen.queryByText("Counting…")).not.toBeInTheDocument();
      // The step still works: the user can fix the group and move on.
      const group = within(screen.getByRole("group"));
      await user.type(group.getByLabelText("Group name"), "Sales");
      await user.selectOptions(group.getByLabelText("Group template"), SALES);
      await user.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("Step 4 of 5")).toBeVisible();
    },
  );

  it("asks for a name and a template before moving on", async () => {
    const user = userEvent.setup();
    renderWizard();
    await goTo(user, 3);
    await user.click(screen.getByRole("button", { name: "Add group" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 3 of 5")).toBeVisible();
    expect(
      within(screen.getByRole("group")).getAllByText("This field is required."),
    ).toHaveLength(2);
  });

  it("creates the cycle with its groups", async () => {
    const user = userEvent.setup();
    renderWizard();
    await goTo(user, 3);
    await user.click(screen.getByRole("button", { name: "Add group" }));
    const group = within(screen.getByRole("group"));
    await user.type(group.getByLabelText("Group name"), "Sales");
    await user.selectOptions(group.getByLabelText("Group template"), SALES);
    await user.click(group.getByRole("checkbox", { name: "Ventas" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.type(screen.getByLabelText("Cycle name"), "H1 2026");
    await user.type(screen.getByLabelText("Period start"), "2026-01-01");
    await user.type(screen.getByLabelText("Period end"), "2026-06-30");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 5 of 5")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/cycles/new-cycle"));
    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "H1 2026", templateId: ANNUAL }),
      [
        {
          name: "Sales",
          templateId: SALES,
          filter: {
            kind: "filter",
            departments: ["Ventas"],
            divisions: [],
            locations: [],
            jobTitles: [],
          },
        },
      ],
    );
  });
});

describe("CycleWizard hire-date schedule", () => {
  async function toDates(user: ReturnType<typeof userEvent.setup>) {
    renderWizard();
    await goTo(user, 4);
    expect(screen.getByText("Step 4 of 5")).toBeVisible();
  }

  it("keeps fixed dates by default", async () => {
    const user = userEvent.setup();
    await toDates(user);
    expect(screen.getByLabelText("Fixed dates")).toBeChecked();
    expect(screen.getByLabelText("Self review")).toBeVisible();
    expect(screen.queryByLabelText("Milestone")).not.toBeInTheDocument();
  });

  it("shows milestone, window and a preview for a recent hire", async () => {
    const user = userEvent.setup();
    await toDates(user);
    await user.click(screen.getByLabelText("By hire date"));
    expect(screen.getByLabelText("Milestone")).toHaveValue("90");
    expect(screen.getByLabelText("Window")).toHaveValue("2");
    // Per-person deadlines replace the per-phase dates.
    expect(screen.queryByLabelText("Self review")).not.toBeInTheDocument();
    expect(screen.getByText("Dana Ruiz, hired on 2026-01-31")).toBeVisible();
    // Jan 31 + 90 days = May 1; plus two weeks.
    expect(
      screen.getByText("Reaches the milestone on 2026-05-01"),
    ).toBeVisible();
    expect(
      screen.getByText("Self and manager review due on 2026-05-15"),
    ).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Milestone"), "30");
    expect(
      screen.getByText("Reaches the milestone on 2026-03-02"),
    ).toBeVisible();
  });

  it("creates a hire-date cycle with its schedule and no phase dates", async () => {
    const user = userEvent.setup();
    await toDates(user);
    await user.type(screen.getByLabelText("Cycle name"), "Onboarding");
    await user.type(screen.getByLabelText("Period start"), "2026-01-01");
    await user.type(screen.getByLabelText("Period end"), "2026-12-31");
    await user.click(screen.getByLabelText("By hire date"));
    await user.selectOptions(screen.getByLabelText("Milestone"), "180");
    await user.selectOptions(screen.getByLabelText("Window"), "3");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Step 5 of 5")).toBeVisible();
    expect(
      screen.getByText("Milestone: 6 months (180 days) · 3 weeks window"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create and launch" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/cycles/new-cycle"));
    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleKind: "hire_date",
        hireDateSchedule: { milestoneDays: 180, windowWeeks: 3 },
        dueDates: {},
      }),
      [],
    );
    expect(actions.launch).toHaveBeenCalledWith("new-cycle");
  });

  it("sends fixed-date cycles without a schedule", async () => {
    const user = userEvent.setup();
    await toDates(user);
    await user.type(screen.getByLabelText("Cycle name"), "H1");
    await user.type(screen.getByLabelText("Period start"), "2026-01-01");
    await user.type(screen.getByLabelText("Period end"), "2026-06-30");
    await user.type(screen.getByLabelText("Self review"), "2026-07-01");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalled());
    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleKind: "fixed",
        hireDateSchedule: null,
        dueDates: { self: "2026-07-01" },
      }),
      [],
    );
  });
});

// ---------------------------------------------------------------- detail

const detail: CycleDetailData = {
  id: "c1",
  name: "H1 2026",
  status: "collecting",
  periodStart: "2026-01-01",
  periodEnd: "2026-06-30",
  snapshotDate: "2026-06-01",
  questionCount: 12,
  stats: { active: 2, removed: 0, withoutManager: 0 },
  allowedTransitions: [],
  scheduleKind: "fixed",
  hireDateSchedule: null,
  defaultTemplateName: { es: "Anual", en: "Annual" },
  groups: [
    {
      id: "g1",
      name: "Engineering",
      templateName: { es: "Ventas", en: "Sales" },
      filter: {
        kind: "filter",
        departments: ["Ingeniería", "Datos"],
        locations: ["Rosario"],
      },
      participantCount: 1,
      questionCount: 7,
    },
  ],
  participants: [
    {
      id: "p1",
      displayName: "Ana García",
      snapManagerName: "Carla Romero",
      snapDepartment: "Dirección",
      snapJobTitle: "CEO",
      withoutManager: false,
      removedAt: null,
      templateGroupId: null,
      dueDates: null,
    },
    {
      id: "p2",
      displayName: "Bruno Pérez",
      snapManagerName: "Carla Romero",
      snapDepartment: "Ingeniería",
      snapJobTitle: "Developer",
      withoutManager: false,
      removedAt: null,
      templateGroupId: "g1",
      dueDates: { self: "2026-03-16", manager: "2026-03-16" },
    },
  ],
  transitions: [
    {
      id: "t1",
      fromStatus: "draft",
      toStatus: "collecting",
      actorName: null,
      note: null,
      createdAt: new Date("2026-06-02T10:00:00Z"),
    },
  ],
};

const detailActions = () => ({
  transition: vi.fn(),
  launch: vi.fn(),
  duplicate: vi
    .fn()
    .mockResolvedValue({ ok: true, id: "copy-1", warnings: [] }),
});

describe("CycleDetailView extras", () => {
  it.each([
    [
      "es",
      "Plantillas por grupo",
      "Plantilla del ciclo: Anual",
      "1 persona sin grupo",
      "Área: Ingeniería, Datos · Ubicación: Rosario",
      "Ventas",
    ],
    [
      "en",
      "Templates per group",
      "Cycle template: Annual",
      "1 person without a group",
      "Department: Ingeniería, Datos · Location: Rosario",
      "Sales",
    ],
  ] as const)(
    "lists the groups with their template, criteria and people in %s",
    (locale, title, defaultTemplate, without, criteria, template) => {
      renderIn(
        locale,
        <CycleDetailView cycle={detail} actions={detailActions()} />,
      );
      const section = screen.getByRole("region", { name: title });
      expect(within(section).getByText(defaultTemplate)).toBeVisible();
      expect(within(section).getByText(without)).toBeVisible();
      const row = within(section).getAllByRole("row")[1];
      expect(within(row).getByText("Engineering")).toBeVisible();
      expect(within(row).getByText(template)).toBeVisible();
      expect(within(row).getByText(criteria)).toBeVisible();
      expect(within(row).getByText("7")).toBeVisible();
    },
  );

  it("shows the group of each participant", () => {
    renderIn(
      "en",
      <CycleDetailView cycle={detail} actions={detailActions()} />,
    );
    const participants = screen.getByRole("table", { name: "Participants" });
    const rows = within(participants).getAllByRole("row");
    expect(within(rows[1]).getByText("No group")).toBeVisible();
    expect(within(rows[2]).getByText("Engineering")).toBeVisible();
  });

  it("hides the group section and column when there are no groups", () => {
    renderIn(
      "en",
      <CycleDetailView
        cycle={{
          ...detail,
          groups: [],
          participants: detail.participants.map((p) => ({
            ...p,
            templateGroupId: null,
          })),
        }}
        actions={detailActions()}
      />,
    );
    expect(
      screen.queryByRole("region", { name: "Templates per group" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No group")).not.toBeInTheDocument();
  });

  it("shows the schedule and each person's own due date for hire-date cycles", () => {
    renderIn(
      "en",
      <CycleDetailView
        cycle={{
          ...detail,
          scheduleKind: "hire_date",
          hireDateSchedule: { milestoneDays: 180, windowWeeks: 3 },
        }}
        actions={detailActions()}
      />,
    );
    expect(
      screen.getByText("Milestone: 6 months (180 days) · 3 weeks window"),
    ).toBeVisible();
    const participants = screen.getByRole("table", { name: "Participants" });
    expect(
      within(participants).getByRole("columnheader", { name: "Due" }),
    ).toBeVisible();
    expect(within(participants).getByText("2026-03-16")).toBeVisible();
  });

  it.each(["draft", "collecting", "closed"] as const)(
    "offers duplicating a cycle in %s status",
    async (status) => {
      const user = userEvent.setup();
      const actions = detailActions();
      renderIn(
        "en",
        <CycleDetailView cycle={{ ...detail, status }} actions={actions} />,
      );
      await user.click(screen.getByRole("button", { name: "Duplicate cycle" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/cycles/copy-1"));
      expect(actions.duplicate).toHaveBeenCalledWith("c1", "Copy");
    },
  );

  it("links a copy to the cycle it came from in its status log", () => {
    renderIn(
      "en",
      <CycleDetailView
        cycle={{
          ...detail,
          status: "draft",
          transitions: [
            {
              id: "t1",
              fromStatus: "draft",
              toStatus: "draft",
              actorName: "Ana García",
              note: "duplicate_of:src-cycle",
              createdAt: new Date("2026-06-02T10:00:00Z"),
            },
          ],
        }}
        actions={detailActions()}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Duplicated from another cycle" }),
    ).toHaveAttribute("href", "/cycles/src-cycle");
    expect(
      screen.queryByText("duplicate_of:src-cycle"),
    ).not.toBeInTheDocument();
  });
});
