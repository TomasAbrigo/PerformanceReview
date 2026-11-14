import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/components/templates/shared";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { AuditLogItem } from "@/modules/review-core/admin-audit";
import type {
  CycleOps,
  ManagerChange,
  OpsParticipantItem,
  OpsRequestItem,
} from "@/modules/review-core/ops";
import { OpsAuditLog } from "./ops-audit-log";
import { OpsCompleteOnBehalf } from "./ops-complete-on-behalf";
import { OpsCycleActions } from "./ops-cycle-actions";
import { OpsParticipantsView } from "./ops-participants";

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

const ok = (): Promise<ActionResult> => Promise.resolve({ ok: true });
const fail = (code: string): Promise<ActionResult> =>
  Promise.resolve({ ok: false, code, issues: [] });

const CYCLE = "00000000-0000-4000-8000-0000000000c1";
const ANA = "00000000-0000-4000-8000-0000000000a1";
const BRUNO = "00000000-0000-4000-8000-0000000000b1";
const CARLA = "00000000-0000-4000-8000-0000000000c2";
const P_ANA = "00000000-0000-4000-8000-0000000000e1";
const P_BRUNO = "00000000-0000-4000-8000-0000000000e2";
const P_DARIO = "00000000-0000-4000-8000-0000000000e3";
const REQ = (n: number) => `00000000-0000-4000-8000-00000000f${n}00`;

// ---------------------------------------------------------------- cycle actions

describe("OpsCycleActions", () => {
  const props = {
    cycleId: CYCLE,
    status: "collecting" as const,
    dueDates: { self: "2022-07-15", manager: "2022-07-30" },
  };

  it.each([
    ["en", "Participants and assessors", "Audit log", "Extend a due date"],
    [
      "es",
      "Participantes y evaluadores",
      "Registro de auditoría",
      "Extender una fecha límite",
    ],
  ] as const)(
    "links to the participants and audit pages (%s)",
    (locale, participants, audit, extend) => {
      renderIn(
        locale,
        <OpsCycleActions {...props} extendDueDate={vi.fn(ok)} />,
      );
      expect(screen.getByRole("link", { name: participants })).toHaveAttribute(
        "href",
        `/cycles/${CYCLE}/participants`,
      );
      expect(screen.getByRole("link", { name: audit })).toHaveAttribute(
        "href",
        `/cycles/${CYCLE}/audit`,
      );
      expect(screen.getByRole("button", { name: extend })).toBeInTheDocument();
    },
  );

  it("extends a phase's due date with an optional reason", async () => {
    const user = userEvent.setup();
    const extend = vi.fn(ok);
    renderIn("en", <OpsCycleActions {...props} extendDueDate={extend} />);
    await user.click(screen.getByRole("button", { name: "Extend a due date" }));
    const form = screen.getByRole("form", { name: "Extend a due date" });
    // Only phases that have a date can be extended.
    const options = within(form)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "Self review (due 2022-07-15)",
      "Manager (due 2022-07-30)",
    ]);
    await user.selectOptions(within(form).getByLabelText("Phase"), "manager");
    await user.type(within(form).getByLabelText("New due date"), "2022-08-15");
    await user.type(within(form).getByLabelText("Reason (optional)"), "Leave");
    await user.click(within(form).getByRole("button", { name: "Extend" }));
    await waitFor(() =>
      expect(extend).toHaveBeenCalledWith(
        CYCLE,
        "manager",
        "2022-08-15",
        "Leave",
      ),
    );
    expect(await screen.findByText("Due date extended.")).toBeInTheDocument();
  });

  it("shows the translated error and keeps the form open", async () => {
    const user = userEvent.setup();
    const extend = vi.fn(() => fail("date_not_forward"));
    renderIn("es", <OpsCycleActions {...props} extendDueDate={extend} />);
    await user.click(
      screen.getByRole("button", { name: "Extender una fecha límite" }),
    );
    const form = screen.getByRole("form", {
      name: "Extender una fecha límite",
    });
    await user.type(
      within(form).getByLabelText("Nueva fecha límite"),
      "2022-07-01",
    );
    await user.click(within(form).getByRole("button", { name: "Extender" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La nueva fecha debe ser posterior a la fecha límite actual.",
    );
    expect(form).toBeInTheDocument();
  });

  it("offers no extension for closed cycles or cycles without due dates", () => {
    const { unmount } = renderIn(
      "en",
      <OpsCycleActions {...props} status="closed" extendDueDate={vi.fn(ok)} />,
    );
    expect(
      screen.queryByRole("button", { name: "Extend a due date" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit log" })).toBeInTheDocument();
    unmount();
    renderIn(
      "en",
      <OpsCycleActions {...props} dueDates={{}} extendDueDate={vi.fn(ok)} />,
    );
    expect(
      screen.queryByRole("button", { name: "Extend a due date" }),
    ).not.toBeInTheDocument();
  });
});

// ------------------------------------------------------------ participants view

const request = (
  over: Partial<OpsRequestItem> & { id: string },
): OpsRequestItem => ({
  relationship: "manager",
  status: "draft",
  reviewerPersonId: null,
  reviewerName: null,
  reviewerMissing: false,
  reviewerMismatch: false,
  additional: false,
  submittedOnBehalf: false,
  canComplete: false,
  ...over,
});

const change: ManagerChange = {
  participantId: P_BRUNO,
  revieweePersonId: BRUNO,
  revieweeName: "Bruno Pérez",
  snapshotManagerId: CARLA,
  snapshotManagerName: "Carla Romero",
  currentManagerId: ANA,
  currentManagerName: "Ana García",
  requestId: REQ(3),
  requestStatus: "draft",
  reviewerId: CARLA,
  reviewerName: "Carla Romero",
  reviewerMismatch: false,
  suggestedAction: "reassign",
};

const participants: OpsParticipantItem[] = [
  {
    participantId: P_ANA,
    personId: ANA,
    displayName: "Ana García",
    removed: false,
    snapManagerName: null,
    snapDepartment: "Dirección",
    change: null,
    requests: [
      request({
        id: REQ(1),
        relationship: "self",
        status: "submitted",
        reviewerPersonId: ANA,
        reviewerName: "Ana García",
      }),
      request({ id: REQ(2), reviewerMissing: true }),
    ],
  },
  {
    participantId: P_BRUNO,
    personId: BRUNO,
    displayName: "Bruno Pérez",
    removed: false,
    snapManagerName: "Carla Romero",
    snapDepartment: "Ingeniería",
    change,
    requests: [
      request({
        id: REQ(4),
        relationship: "self",
        reviewerPersonId: BRUNO,
        reviewerName: "Bruno Pérez",
        canComplete: true,
      }),
      request({
        id: REQ(3),
        reviewerPersonId: CARLA,
        reviewerName: "Carla Romero",
        canComplete: true,
      }),
      request({
        id: REQ(5),
        reviewerPersonId: ANA,
        reviewerName: "Ana García",
        additional: true,
        reviewerMismatch: true,
        status: "submitted",
        submittedOnBehalf: true,
      }),
    ],
  },
  {
    participantId: P_DARIO,
    personId: "00000000-0000-4000-8000-0000000000d1",
    displayName: "Darío Gómez",
    removed: true,
    snapManagerName: "Carla Romero",
    snapDepartment: "Ingeniería",
    change: null,
    requests: [],
  },
];

const data: CycleOps = {
  cycle: { id: CYCLE, name: "H1 2022", status: "collecting", dueDates: {} },
  participants,
  candidates: [{ id: CARLA, displayName: "Carla Romero" }],
  people: [
    { id: ANA, displayName: "Ana García" },
    { id: BRUNO, displayName: "Bruno Pérez" },
    { id: CARLA, displayName: "Carla Romero" },
  ],
};

function actions() {
  return {
    add: vi.fn(ok),
    remove: vi.fn(ok),
    assign: vi.fn(ok),
    unlock: vi.fn(ok),
  };
}

/** The participants-table row whose first cell starts with `name`. */
function rowOf(name: string) {
  const row = screen
    .getAllByRole("row")
    .find((r) =>
      within(r).queryAllByRole("cell")[0]?.textContent?.startsWith(name),
    );
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("OpsParticipantsView", () => {
  it("shows requests, mismatch and missing-assessor badges and the manager change", () => {
    renderIn("en", <OpsParticipantsView data={data} actions={actions()} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Participants and assessors: H1 2022",
      }),
    ).toBeInTheDocument();
    const ana = within(rowOf("Ana García"));
    expect(ana.getByText("No assessor")).toBeInTheDocument();
    expect(ana.getByText("No manager")).toBeInTheDocument();
    const bruno = within(rowOf("Bruno Pérez"));
    expect(
      bruno.getByText("Reviewer differs from the snapshot"),
    ).toBeInTheDocument();
    expect(bruno.getByText("Additional")).toBeInTheDocument();
    expect(bruno.getByText("Completed on behalf")).toBeInTheDocument();
    expect(
      bruno.getByText("Now reports to Ana García (snapshot: Carla Romero)"),
    ).toBeInTheDocument();
    expect(
      bruno.getByText("Suggested: move the review to Ana García"),
    ).toBeInTheDocument();
    const dario = within(rowOf("Darío Gómez"));
    expect(dario.getByText("Removed")).toBeInTheDocument();
    expect(dario.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("renders in Spanish", () => {
    renderIn("es", <OpsParticipantsView data={data} actions={actions()} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Participantes y evaluadores: H1 2022",
      }),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Ana García")).getByText("Sin evaluador"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Bruno Pérez")).getByText(
        "El evaluador difiere del snapshot",
      ),
    ).toBeInTheDocument();
    expect(
      within(rowOf("Ana García")).getByRole("button", {
        name: "Asignar evaluador",
      }),
    ).toBeInTheDocument();
  });

  it("links completing a draft on behalf and offers unlocking submitted ones", () => {
    renderIn("en", <OpsParticipantsView data={data} actions={actions()} />);
    const bruno = within(rowOf("Bruno Pérez"));
    const links = bruno.getAllByRole("link", { name: "Complete on behalf" });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `/cycles/${CYCLE}/participants/complete/${REQ(4)}`,
      `/cycles/${CYCLE}/participants/complete/${REQ(3)}`,
    ]);
    expect(bruno.getAllByRole("button", { name: "Unlock" })).toHaveLength(1);
    expect(
      within(rowOf("Ana García")).getAllByRole("button", { name: "Unlock" }),
    ).toHaveLength(1);
  });

  it("adds a participant with an optional reason", async () => {
    const user = userEvent.setup();
    const a = actions();
    renderIn("en", <OpsParticipantsView data={data} actions={a} />);
    const form = screen.getByRole("form", { name: "Add a participant" });
    await user.selectOptions(within(form).getByLabelText("Person"), CARLA);
    await user.type(
      within(form).getByLabelText("Reason (optional)"),
      "Late hire",
    );
    await user.click(
      within(form).getByRole("button", { name: "Add participant" }),
    );
    await waitFor(() =>
      expect(a.add).toHaveBeenCalledWith(CYCLE, CARLA, "Late hire"),
    );
  });

  it("says when nobody can be added", () => {
    renderIn(
      "en",
      <OpsParticipantsView
        data={{ ...data, candidates: [] }}
        actions={actions()}
      />,
    );
    expect(
      screen.getByText("Everyone eligible already takes part."),
    ).toBeInTheDocument();
  });

  it("removes a participant after confirming", async () => {
    const user = userEvent.setup();
    const a = actions();
    renderIn("en", <OpsParticipantsView data={data} actions={a} />);
    await user.click(
      within(rowOf("Bruno Pérez")).getByRole("button", { name: "Remove" }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Remove Bruno Pérez from the cycle?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Remove participant" }),
    );
    await waitFor(() =>
      expect(a.remove).toHaveBeenCalledWith(CYCLE, BRUNO, null),
    );
  });

  it("unlocks a submitted review with a reason", async () => {
    const user = userEvent.setup();
    const a = actions();
    renderIn("en", <OpsParticipantsView data={data} actions={a} />);
    await user.click(
      within(rowOf("Ana García")).getByRole("button", { name: "Unlock" }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Unlock this review?",
    });
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "Typo");
    await user.click(within(dialog).getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(a.unlock).toHaveBeenCalledWith(REQ(1), "Typo"));
  });

  it("requires an assessor to replace the missing manager (additional is disabled)", async () => {
    const user = userEvent.setup();
    const a = actions();
    renderIn("en", <OpsParticipantsView data={data} actions={a} />);
    await user.click(
      within(rowOf("Ana García")).getByRole("button", {
        name: "Assign assessor",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Assign an assessor to Ana García",
    });
    expect(
      within(dialog).getByText(
        "Ana García has no manager: the assessor takes over the manager review.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: "Add an additional assessor" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("radio", {
        name: "Replace the manager's review",
      }),
    ).toBeChecked();
    await user.selectOptions(within(dialog).getByLabelText("Assessor"), CARLA);
    await user.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() =>
      expect(a.assign).toHaveBeenCalledWith(P_ANA, CARLA, "replace", null),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("preselects the suggestion after a manager change and sends the mode and reason", async () => {
    const user = userEvent.setup();
    const a = actions();
    renderIn("en", <OpsParticipantsView data={data} actions={a} />);
    await user.click(
      within(rowOf("Bruno Pérez")).getByRole("button", {
        name: "Assign assessor",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Assign an assessor to Bruno Pérez",
    });
    expect(within(dialog).getByLabelText("Assessor")).toHaveValue(ANA);
    await user.click(
      within(dialog).getByRole("radio", { name: "Add an additional assessor" }),
    );
    await user.type(
      within(dialog).getByLabelText("Reason (optional)"),
      "Leave",
    );
    await user.click(within(dialog).getByRole("button", { name: "Assign" }));
    await waitFor(() =>
      expect(a.assign).toHaveBeenCalledWith(
        P_BRUNO,
        ANA,
        "additional",
        "Leave",
      ),
    );
  });

  it("keeps the dialog open and shows the translated error when the action fails", async () => {
    const user = userEvent.setup();
    const a = actions();
    a.assign.mockImplementationOnce(() => fail("already_assigned"));
    renderIn("es", <OpsParticipantsView data={data} actions={a} />);
    await user.click(
      within(rowOf("Bruno Pérez")).getByRole("button", {
        name: "Asignar evaluador",
      }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Asignar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Esa persona ya es evaluadora de este participante.",
    );
  });
});

// -------------------------------------------------------------------- audit log

const entries: AuditLogItem[] = [
  {
    id: "a2",
    action: "due_date_extended",
    targetType: "cycle",
    targetId: CYCLE,
    actorPersonId: ANA,
    actorName: "Ana García",
    targetLabel: null,
    before: { phase: "manager", date: "2022-07-30" },
    after: { phase: "manager", date: "2022-08-15" },
    note: "Vacaciones",
    createdAt: new Date("2022-07-20T15:30:00Z"),
  },
  {
    id: "a1",
    action: "participant_added",
    targetType: "participant",
    targetId: P_BRUNO,
    actorPersonId: null,
    actorName: null,
    targetLabel: "Bruno Pérez",
    before: null,
    after: { personId: BRUNO, snapshotAsOf: "2022-07-01" },
    note: null,
    createdAt: new Date("2022-07-01T10:00:00Z"),
  },
];

describe("OpsAuditLog", () => {
  it("lists the entries with actor, target and reason, and diffs before/after", () => {
    renderIn(
      "en",
      <OpsAuditLog
        cycleName="H1 2022"
        cycleId={CYCLE}
        entries={entries}
        action={null}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Audit log: H1 2022" }),
    ).toBeInTheDocument();
    // The entries' own rows (each also holds a small table of changes).
    const table = screen.getByRole("table", { name: "Administrative actions" });
    const rows = within(table)
      .getAllByRole("row")
      .filter((r) => r.closest("table") === table)
      .slice(1);
    expect(rows).toHaveLength(2);
    const extended = within(rows[0]);
    expect(extended.getByText("Due date extended")).toBeInTheDocument();
    expect(extended.getByText("Ana García")).toBeInTheDocument();
    expect(extended.getByText("The cycle")).toBeInTheDocument();
    expect(extended.getByText("Vacaciones")).toBeInTheDocument();
    // Only the field that changed, with both values.
    const diff = within(
      extended.getByRole("table", { name: "Changes" }),
    ).getAllByRole("row");
    expect(diff).toHaveLength(2); // header + date
    expect(within(diff[1]).getByText("date")).toBeInTheDocument();
    expect(within(diff[1]).getByText("2022-07-30")).toBeInTheDocument();
    expect(within(diff[1]).getByText("2022-08-15")).toBeInTheDocument();

    const added = within(rows[1]);
    expect(added.getByText("Participant added")).toBeInTheDocument();
    expect(added.getByText("People")).toBeInTheDocument(); // no actor person
    expect(added.getByText("Bruno Pérez")).toBeInTheDocument();
    // Without a "before" every field of "after" is new.
    expect(added.getByText("snapshotAsOf")).toBeInTheDocument();
    expect(added.getByText("2022-07-01")).toBeInTheDocument();
  });

  it("renders in Spanish and filters by action with a plain GET form", () => {
    renderIn(
      "es",
      <OpsAuditLog
        cycleName="H1 2022"
        cycleId={CYCLE}
        entries={entries.slice(0, 1)}
        action="due_date_extended"
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Registro de auditoría: H1 2022",
      }),
    ).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Filtrar el registro" });
    expect(form).toHaveAttribute("method", "get");
    const select = within(form).getByLabelText("Acción");
    expect(select).toHaveValue("due_date_extended");
    expect(select).toHaveAttribute("name", "action");
    expect(
      within(select).getByRole("option", { name: "Todas las acciones" }),
    ).toHaveValue("");
    expect(
      within(select).getByRole("option", { name: "Evaluador asignado" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fecha límite extendida", { selector: "td" }),
    ).toBeInTheDocument();
  });

  it("says when nothing was recorded", () => {
    renderIn(
      "en",
      <OpsAuditLog
        cycleName="H1 2022"
        cycleId={CYCLE}
        entries={[]}
        action={null}
      />,
    );
    expect(
      screen.getByText("No administrative actions have been recorded."),
    ).toBeInTheDocument();
  });
});

// ------------------------------------------------------- complete on behalf

const rating = {
  options: [
    { value: 1, label: { es: "Bajo", en: "Low" }, normalized: 0 },
    { value: 2, label: { es: "Alto", en: "High" }, normalized: 1 },
  ],
};

const view = {
  requestId: REQ(4),
  cycleId: CYCLE,
  cycleName: "H1 2022",
  revieweeName: "Bruno Pérez",
  reviewerName: "Carla Romero",
  dueDate: "2022-07-30",
  status: "draft" as const,
  submittedAt: null,
  canComplete: true,
  questions: [
    {
      id: "q1",
      sectionTitle: { es: "Evaluación", en: "Review" },
      prompt: { es: "Calificación", en: "Overall rating" },
      kind: "rating" as const,
      required: true,
      scale: rating,
      choices: null,
    },
    {
      id: "q2",
      sectionTitle: { es: "Evaluación", en: "Review" },
      prompt: { es: "Comentarios", en: "Comments" },
      kind: "text" as const,
      required: false,
      scale: null,
      choices: null,
    },
  ],
  answers: {},
};

describe("OpsCompleteOnBehalf", () => {
  it("keeps answers locally and completes once with the reason", async () => {
    const user = userEvent.setup();
    const complete = vi.fn(ok);
    renderIn("en", <OpsCompleteOnBehalf view={view} complete={complete} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Complete on behalf: Carla Romero's review of Bruno Pérez",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /You are completing this review in the name of Carla Romero/,
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "High" }));
    const comments = screen.getByRole("textbox", { name: /Comments/ });
    await user.type(comments, "Great year");
    await user.tab();
    await user.type(screen.getByLabelText("Reason (optional)"), "On leave");
    expect(complete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm submission" }),
    );
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const [requestId, answers, note] = complete.mock.calls[0] as unknown as [
      string,
      { questionRevisionId: string; value: unknown }[],
      string | null,
    ];
    expect(requestId).toBe(REQ(4));
    expect(note).toBe("On leave");
    expect(answers).toEqual(
      expect.arrayContaining([
        { questionRevisionId: "q1", value: 2 },
        { questionRevisionId: "q2", value: "Great year" },
      ]),
    );
  });

  it("is read-only with a message when it cannot be completed now", () => {
    renderIn(
      "es",
      <OpsCompleteOnBehalf
        view={{ ...view, canComplete: false }}
        complete={vi.fn(ok)}
      />,
    );
    expect(
      screen.getByText(
        "Esta evaluación no se puede completar en nombre de otro ahora.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
  });
});
