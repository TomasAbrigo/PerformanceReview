import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { IssueDetailData, IssueListItem } from "@/modules/identity";
import { IdentityQueue } from "./identity-queue";
import { IssueDetail, type IssueActions } from "./issue-detail";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({
    href,
    children,
    ...props
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const messages = { es, en };

function renderIn(locale: "es" | "en", ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const summary = {
  displayName: "Carla Romero",
  employeeNumber: "0003",
  workEmail: "carla.romero@example.com",
  hireDate: "2025-03-01",
  terminationDate: null,
  status: "Active",
};

const item = (overrides: Partial<IssueListItem> = {}): IssueListItem => ({
  id: "i1",
  reason: "ambiguous",
  status: "open",
  sourceSystem: "bamboo_api",
  entity: "employee",
  sourceId: "201",
  ingestRunId: "r1",
  candidateCount: 1,
  summary,
  resolution: null,
  createdAt: new Date("2026-03-02T10:00:00Z"),
  resolvedAt: null,
  ...overrides,
});

const carla = {
  personId: "p-carla",
  score: 0.94,
  matchedOn: ["employee_number", "work_email"] as (
    "employee_number" | "work_email"
  )[],
  displayName: "Carla Romero",
  workEmail: "carla.romero@example.com",
  employments: [
    { hireDate: null, terminationDate: "2024-06-30", status: "Inactive" },
  ],
};

const detail = (overrides: Partial<IssueDetailData> = {}): IssueDetailData => ({
  ...item(),
  payload: { id: 201 },
  candidates: [carla],
  resolvedPerson: null,
  ...overrides,
});

describe("IdentityQueue", () => {
  it.each([
    ["es", "No hay nada para revisar: todos los registros se asignaron."],
    ["en", "Nothing to review: every record was matched."],
  ] as const)("shows the empty state in %s", (locale, empty) => {
    renderIn(locale, <IdentityQueue issues={[]} tab="open" openCount={0} />);

    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it.each([
    ["es", "Cola de identidad", "Posible coincidencia", "1 candidato"],
    ["en", "Identity queue", "Possible match", "1 candidate"],
  ] as const)(
    "lists open cases with reason and candidates in %s",
    (locale, heading, reason, candidates) => {
      renderIn(
        locale,
        <IdentityQueue
          issues={[
            item(),
            item({
              id: "i2",
              reason: "no_match",
              sourceId: "205",
              candidateCount: 0,
              summary: { ...summary, displayName: "Elena Sosa" },
            }),
          ]}
          tab="open"
          openCount={2}
        />,
      );

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(
        within(rows[0]).getByRole("link", { name: "Carla Romero" }),
      ).toHaveAttribute("href", "/imports/identity/i1");
      expect(within(rows[0]).getByText("201")).toBeInTheDocument();
      expect(within(rows[0]).getByText(reason)).toBeInTheDocument();
      expect(within(rows[0]).getByText(candidates)).toBeInTheDocument();
      expect(
        within(rows[1]).getByText(
          locale === "es" ? "Sin candidatos" : "No candidates",
        ),
      ).toBeInTheDocument();
    },
  );

  it("links the open and history views, marking the current one", () => {
    renderIn("en", <IdentityQueue issues={[]} tab="open" openCount={3} />);

    const nav = screen.getByRole("navigation", { name: "Queue views" });
    expect(within(nav).getByRole("link", { name: "Open (3)" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "History" })).toHaveAttribute(
      "href",
      "/imports/identity?tab=history",
    );
  });

  it("shows how history cases ended", () => {
    renderIn(
      "en",
      <IdentityQueue
        tab="history"
        openCount={0}
        issues={[
          item({
            status: "resolved",
            resolvedAt: new Date("2026-03-03T10:00:00Z"),
            resolution: { action: "link", personId: "p-carla" },
          }),
          item({
            id: "i2",
            status: "ignored",
            resolvedAt: new Date("2026-03-03T11:00:00Z"),
            resolution: { action: "ignore", actorNote: "Contractor" },
          }),
        ]}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Linked")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Ignored")).toBeInTheDocument();
  });

  it("shows an empty history", () => {
    renderIn("es", <IdentityQueue issues={[]} tab="history" openCount={1} />);
    expect(
      screen.getByText("Todavía no hay casos resueltos."),
    ).toBeInTheDocument();
  });
});

function makeActions(): IssueActions {
  return {
    link: vi.fn().mockResolvedValue({ ok: true }),
    create: vi.fn().mockResolvedValue({ ok: true }),
    ignore: vi.fn().mockResolvedValue({ ok: true }),
    searchPeople: vi.fn().mockResolvedValue([]),
  };
}

describe("IssueDetail", () => {
  beforeEach(() => push.mockClear());

  it.each([
    [
      "es",
      "Registro de Bamboo",
      "Legajo",
      "Personas sugeridas",
      "Coincide en",
      "94% de coincidencia",
    ],
    [
      "en",
      "Record from Bamboo",
      "Employee number",
      "Suggested people",
      "Matched on",
      "94% match",
    ],
  ] as const)(
    "shows the record and the suggested candidates in %s",
    (locale, record, legajo, suggested, matched, score) => {
      renderIn(
        locale,
        <IssueDetail issue={detail()} actions={makeActions()} />,
      );

      expect(
        screen.getByRole("heading", { level: 1, name: "Carla Romero" }),
      ).toBeInTheDocument();
      const fields = screen.getByRole("region", { name: record });
      expect(within(fields).getByText(legajo)).toBeInTheDocument();
      expect(within(fields).getByText("0003")).toBeInTheDocument();
      expect(within(fields).getByText("2025-03-01")).toBeInTheDocument();

      expect(screen.getByText(suggested)).toBeInTheDocument();
      const candidate = screen.getByRole("listitem", { name: "Carla Romero" });
      expect(
        within(candidate).getByRole("link", { name: "Carla Romero" }),
      ).toHaveAttribute("href", "/people/p-carla");
      expect(within(candidate).getByText(matched)).toBeInTheDocument();
      expect(within(candidate).getByText(legajo)).toBeInTheDocument();
      expect(within(candidate).getByText(score)).toBeInTheDocument();
      expect(
        within(candidate).getByText("2024-06-30", { exact: false }),
      ).toBeInTheDocument();
    },
  );

  it("links the record to the chosen candidate with the note", async () => {
    const actions = makeActions();
    const user = userEvent.setup();
    renderIn("en", <IssueDetail issue={detail()} actions={actions} />);

    await user.type(screen.getByLabelText("Note (optional)"), "It is her");
    await user.click(
      screen.getByRole("button", { name: "Link to Carla Romero" }),
    );

    await waitFor(() =>
      expect(actions.link).toHaveBeenCalledWith("i1", "p-carla", "It is her"),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/imports/identity"));
  });

  it("creates a new person", async () => {
    const actions = makeActions();
    const user = userEvent.setup();
    renderIn("es", <IssueDetail issue={detail()} actions={actions} />);

    await user.click(
      screen.getByRole("button", { name: "Crear persona nueva" }),
    );

    await waitFor(() => expect(actions.create).toHaveBeenCalledWith("i1", ""));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/imports/identity"));
  });

  it("ignores the case", async () => {
    const actions = makeActions();
    const user = userEvent.setup();
    renderIn("en", <IssueDetail issue={detail()} actions={actions} />);

    await user.click(screen.getByRole("button", { name: "Ignore" }));

    await waitFor(() => expect(actions.ignore).toHaveBeenCalledWith("i1", ""));
  });

  it.each([
    [
      "es",
      "Ninguna persona existente se parece a este registro.",
      "Crear persona nueva",
    ],
    ["en", "No existing person looks like this record.", "Create new person"],
  ] as const)(
    "without candidates offers create, ignore and search in %s",
    (locale, none, create) => {
      renderIn(
        locale,
        <IssueDetail
          issue={detail({
            reason: "no_match",
            candidates: [],
            candidateCount: 0,
          })}
          actions={makeActions()}
        />,
      );

      expect(screen.getByText(none)).toBeInTheDocument();
      expect(
        screen.queryByRole("listitem", { name: /./ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^(Link|Vincular)/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: create })).toBeInTheDocument();
      expect(screen.getByRole("searchbox")).toBeInTheDocument();
    },
  );

  it("searches another person and links to the result", async () => {
    const actions = makeActions();
    vi.mocked(actions.searchPeople).mockResolvedValue([
      { id: "p-ana", displayName: "Ana García", workEmail: "ana@example.com" },
    ]);
    const user = userEvent.setup();
    renderIn(
      "en",
      <IssueDetail
        issue={detail({ candidates: [], candidateCount: 0 })}
        actions={actions}
      />,
    );

    await user.type(screen.getByRole("searchbox"), "ana");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(actions.searchPeople).toHaveBeenCalledWith("ana");
    await user.click(
      await screen.findByRole("button", { name: "Link to Ana García" }),
    );
    await waitFor(() =>
      expect(actions.link).toHaveBeenCalledWith("i1", "p-ana", ""),
    );
  });

  it("says when a search finds nobody", async () => {
    const user = userEvent.setup();
    renderIn("en", <IssueDetail issue={detail()} actions={makeActions()} />);

    await user.type(screen.getByRole("searchbox"), "zzz");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No person found.")).toBeInTheDocument();
  });

  it("only offers to ignore a conflict", () => {
    renderIn(
      "en",
      <IssueDetail
        issue={detail({
          reason: "conflict",
          candidates: [{ ...carla, matchedOn: ["work_email"] }],
        })}
        actions={makeActions()}
      />,
    );

    expect(screen.getByText("People involved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ignore" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create new person" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Link/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("shows the error of a failed action and stays on the page", async () => {
    const actions = makeActions();
    vi.mocked(actions.create).mockResolvedValue({
      ok: false,
      code: "already_resolved",
    });
    const user = userEvent.setup();
    renderIn("en", <IssueDetail issue={detail()} actions={actions} />);

    await user.click(screen.getByRole("button", { name: "Create new person" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This case was already resolved in a different way.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    [
      "es",
      { action: "link", personId: "p-carla", actorNote: "Es ella" } as const,
      "Vinculado a Carla Romero",
      "Nota: Es ella",
    ],
    ["en", { action: "ignore" } as const, "Ignored", null],
  ] as const)(
    "shows the resolution of a settled case without actions in %s",
    (locale, resolution, text, note) => {
      renderIn(
        locale,
        <IssueDetail
          issue={detail({
            status: resolution.action === "ignore" ? "ignored" : "resolved",
            resolution,
            resolvedAt: new Date("2026-03-03T10:00:00Z"),
            resolvedPerson:
              resolution.action === "link"
                ? { id: "p-carla", displayName: "Carla Romero" }
                : null,
          })}
          actions={makeActions()}
        />,
      );

      const section = screen.getByRole("region", {
        name: locale === "es" ? "Resolución" : "Resolution",
      });
      expect(within(section).getByText(text)).toBeInTheDocument();
      if (note) expect(within(section).getByText(note)).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );
});
