import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import {
  type CompletionDelta,
  type CompletionSummary,
  type MissingPerson,
  withRates,
} from "@/modules/analytics/completion/types";
import { CompletionFilters, MissingStatusToggle } from "./completion-filters";
import { CompletionSummaryView, Delta } from "./completion-view";
import { MissingTable } from "./missing-table";
import { completionHref, parseCompletionParams } from "./params";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const messages = { es, en };
const renderIn = (locale: "es" | "en", ui: ReactNode) =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );
const locales = ["es", "en"] as const;

const counts = (
  participants: number,
  selfSubmitted: number,
  selfApplicable: number,
  managerSubmitted: number,
  managerApplicable: number,
) => ({
  participants,
  selfSubmitted,
  selfApplicable,
  managerSubmitted,
  managerApplicable,
});

const summary = (over: Partial<CompletionSummary> = {}): CompletionSummary => ({
  cycleId: "c1",
  cycleName: "2025-H1",
  groupBy: "department",
  hierarchy: "asOf",
  minGroupSize: null,
  participants: 4,
  total: withRates(null, null, counts(4, 3, 4, 1, 3)),
  groups: [
    withRates("Tecnología", "Tecnología", counts(3, 2, 3, 1, 3)),
    withRates(null, null, counts(1, 1, 1, 0, 0)),
  ],
  others: null,
  suppressed: 0,
  sources: { progress: 3, requests: 1 },
  ...over,
});

const withDelta: CompletionDelta = {
  current: summary(),
  previous: summary({ cycleId: "c0", cycleName: "2024-H2" }),
  total: { selfDelta: -8.3, managerDelta: 12 },
  groups: [
    {
      key: "Tecnología",
      label: "Tecnología",
      selfDelta: -33.3,
      managerDelta: 0,
    },
    { key: null, label: null, selfDelta: null, managerDelta: null },
  ],
  others: null,
};

describe.each(locales)("CompletionSummaryView (%s)", (locale) => {
  const text = {
    es: {
      meter: "Autoevaluación, Tecnología: 2 de 3 enviadas",
      managerMeter: "Evaluación del manager, Tecnología: 1 de 3 enviadas",
      total: "Total del ciclo",
      unassigned: "Sin asignar",
      compared: "Comparación con 2024-H2",
      none: "No hay un ciclo anterior para comparar.",
      down: "Bajó",
      up: "Subió",
      same: "Sin cambios",
      notApplicable: "No aplica",
    },
    en: {
      meter: "Self assessment, Tecnología: 2 of 3 submitted",
      managerMeter: "Manager assessment, Tecnología: 1 of 3 submitted",
      total: "Whole cycle",
      unassigned: "Unassigned",
      compared: "Compared with 2024-H2",
      none: "There is no earlier cycle to compare with.",
      down: "Down",
      up: "Up",
      same: "No change",
      notApplicable: "Does not apply",
    },
  }[locale];

  it("shows the whole cycle and each group with meters, percentages and counts", () => {
    renderIn(locale, <CompletionSummaryView data={withDelta} />);
    const groups = screen.getAllByTestId("completion-group");
    expect(groups).toHaveLength(3);
    expect(within(groups[0]).getByText(text.total)).toBeInTheDocument();
    expect(within(groups[0]).getByText("75 %")).toBeInTheDocument();
    expect(within(groups[0]).getByText("3/4")).toBeInTheDocument();
    expect(within(groups[1]).getByText("Tecnología")).toBeInTheDocument();
    expect(
      within(groups[1]).getByRole("img", { name: text.meter }),
    ).toBeInTheDocument();
    expect(
      within(groups[1]).getByRole("img", { name: text.managerMeter }),
    ).toBeInTheDocument();
    expect(within(groups[1]).getByText("67 %")).toBeInTheDocument();
    expect(within(groups[1]).getByText("33 %")).toBeInTheDocument();
    // The unassigned group's manager side does not apply to anybody.
    expect(within(groups[2]).getByText(text.unassigned)).toBeInTheDocument();
    expect(within(groups[2]).getByText(text.notApplicable)).toBeInTheDocument();
  });

  it("compares with the previous cycle with an arrow and a signed number", () => {
    renderIn(locale, <CompletionSummaryView data={withDelta} />);
    expect(screen.getByTestId("delta-hint")).toHaveTextContent(text.compared);
    const [total, tech, unassigned] = screen.getAllByTestId("completion-group");
    const deltas = (row: HTMLElement) =>
      within(row)
        .queryAllByTestId("delta")
        .map((d) => d.textContent);
    expect(deltas(total)).toEqual([
      expect.stringMatching(/▼.*8[.,]3 pp/),
      expect.stringMatching(/▲.*\+12 pp/),
    ]);
    expect(deltas(tech)).toEqual([
      expect.stringMatching(new RegExp(`▼.*${text.down}.*33[.,]3 pp`)),
      expect.stringMatching(new RegExp(`▬.*${text.same}.*0 pp`)),
    ]);
    // No rate to compare: a dash, no arrow.
    expect(deltas(unassigned)).toEqual([]);
  });

  it("shows no delta when there is no earlier cycle", () => {
    renderIn(
      locale,
      <CompletionSummaryView
        data={{
          current: summary(),
          previous: null,
          total: null,
          groups: [null, null].map(() => ({
            key: null,
            label: null,
            selfDelta: null,
            managerDelta: null,
          })),
          others: null,
        }}
      />,
    );
    expect(screen.getByTestId("delta-hint")).toHaveTextContent(text.none);
    expect(screen.queryAllByTestId("delta")).toHaveLength(0);
  });

  it("has a table view with the same numbers", () => {
    renderIn(locale, <CompletionSummaryView data={withDelta} />);
    const table = screen.getByRole("table", { hidden: true });
    expect(
      within(table)
        .getAllByRole("row", { hidden: true })
        .map((r) => r.textContent),
    ).toEqual([
      expect.stringContaining(locale === "es" ? "Grupo" : "Group"),
      expect.stringMatching(new RegExp(`^${text.total}43/41/3$`)),
      expect.stringMatching(/^Tecnología32\/31\/3$/),
      expect.stringMatching(new RegExp(`^${text.unassigned}11/1`)),
    ]);
  });

  it("direction: Otros, what was left out, and no source line", () => {
    renderIn(
      locale,
      <CompletionSummaryView
        data={{
          current: summary({
            minGroupSize: 3,
            groups: [
              withRates("Tecnología", "Tecnología", counts(3, 2, 3, 1, 3)),
            ],
            others: withRates(null, null, counts(3, 3, 3, 3, 3)),
            suppressed: 2,
            participants: 9,
            total: withRates(null, null, counts(9, 5, 6, 4, 6)),
          }),
          previous: null,
          total: null,
          groups: [
            {
              key: "Tecnología",
              label: "Tecnología",
              selfDelta: null,
              managerDelta: null,
            },
          ],
          others: null,
        }}
      />,
    );
    const groups = screen.getAllByTestId("completion-group");
    expect(groups).toHaveLength(3);
    expect(
      within(groups[2]).getByText(locale === "es" ? "Otros" : "Others"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        locale === "es"
          ? "2 personas quedan fuera del desglose: su grupo tiene menos de 3."
          : "2 people are left out of the breakdown: their group has fewer than 3.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Assessment Progress/)).not.toBeInTheDocument();
  });

  it("direction under the minimum gets only the head count", () => {
    renderIn(
      locale,
      <CompletionSummaryView
        data={{
          current: summary({
            minGroupSize: 5,
            participants: 4,
            total: null,
            groups: [],
          }),
          previous: null,
          total: null,
          groups: [],
          others: null,
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      locale === "es"
        ? "Hay menos de 5 participantes: solo se muestra la cantidad (4)."
        : "There are fewer than 5 participants: only the head count is shown (4).",
    );
    expect(screen.queryAllByTestId("completion-group")).toHaveLength(0);
  });

  it("says where the statuses came from, and when there is nobody", () => {
    const { unmount } = renderIn(
      locale,
      <CompletionSummaryView data={withDelta} />,
    );
    expect(
      screen.getByText(
        locale === "es"
          ? /Assessment Progress para 3 participantes y de los pedidos de evaluación para 1 participante/
          : /Assessment Progress for 3 participants and from the review requests for 1 participant\./,
      ),
    ).toBeInTheDocument();
    unmount();
    renderIn(
      locale,
      <CompletionSummaryView
        data={{
          current: summary({
            participants: 0,
            total: withRates(null, null, counts(0, 0, 0, 0, 0)),
            groups: [],
          }),
          previous: null,
          total: null,
          groups: [],
          others: null,
        }}
      />,
    );
    expect(
      screen.getByText(
        locale === "es"
          ? "No hay participantes con estos filtros."
          : "There are no participants for these filters.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Delta", () => {
  it("renders nothing without an earlier cycle", () => {
    const { container } = renderIn("en", <Delta value={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("formats the number in the locale's way", () => {
    renderIn("es", <Delta value={16.7} />);
    expect(screen.getByTestId("delta")).toHaveTextContent("▲ Subió +16,7 pp");
  });
});

const person = (over: Partial<MissingPerson> = {}): MissingPerson => ({
  personId: "p1",
  participantId: "cp1",
  name: "Beto Benítez",
  department: "Tecnología",
  managerId: "m1",
  managerName: "Marta Gómez",
  selfStatus: "submitted",
  managerStatus: "in_progress",
  hasFollowUpNotes: false,
  source: "progress",
  ...over,
});

describe.each(locales)("MissingTable (%s)", (locale) => {
  const t = {
    es: {
      title: "Quién falta",
      count: "Faltan 2 personas",
      one: "Falta 1 persona",
      none: "Nadie falta",
      empty: "Nadie falta con estos filtros.",
      submitted: "Enviada",
      inProgress: "En curso",
      notStarted: "No iniciada",
      notes: "Con notas de seguimiento",
      unassigned: "Sin asignar",
    },
    en: {
      title: "Who is missing",
      count: "2 people are missing",
      one: "1 person is missing",
      none: "Nobody is missing",
      empty: "Nobody is missing for these filters.",
      submitted: "Submitted",
      inProgress: "In progress",
      notStarted: "Not started",
      notes: "Has follow-up notes",
      unassigned: "Unassigned",
    },
  }[locale];

  it("lists people with a status chip per side and whether there are notes", () => {
    renderIn(
      locale,
      <MissingTable
        rows={[
          person(),
          person({
            participantId: "cp2",
            name: "Carla Cabrera",
            department: null,
            managerName: null,
            selfStatus: "not_started",
            managerStatus: "not_started",
            hasFollowUpNotes: true,
            // Never rendered, even if it came along.
            email: "carla@example.test",
          }),
        ]}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(t.count);
    const table = screen.getByRole("table", { name: t.title });
    const [, beto, carla] = within(table).getAllByRole("row");
    expect(within(beto).getByText("Beto Benítez")).toBeInTheDocument();
    expect(within(beto).getByText("Marta Gómez")).toBeInTheDocument();
    expect(within(beto).getByText(t.submitted)).toHaveAttribute(
      "data-status",
      "submitted",
    );
    expect(within(beto).getByText(t.inProgress)).toHaveAttribute(
      "data-status",
      "in_progress",
    );
    expect(within(beto).queryByText(t.notes)).not.toBeInTheDocument();
    expect(within(carla).getAllByText(t.notStarted)).toHaveLength(2);
    expect(within(carla).getAllByText(t.unassigned)).toHaveLength(2);
    expect(within(carla).getByText(t.notes)).toBeInTheDocument();
    expect(table).not.toHaveTextContent("carla@example.test");
  });

  it("says so when nobody is missing", () => {
    renderIn(locale, <MissingTable rows={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(t.none);
    expect(screen.getByText(t.empty)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe.each(locales)("CompletionFilters (%s)", (locale) => {
  const params = parseCompletionParams({ cycle: "c1", groupBy: "manager" });
  const options = {
    departments: ["Tecnología", "Ventas"],
    managers: [{ id: "m1", name: "Marta Gómez" }],
    locations: [],
    jobTitles: [],
  };
  const label = {
    es: {
      filters: "Filtros",
      cycle: "Ciclo",
      department: "Área",
      manager: "Manager",
      groupBy: "Agrupar por",
      hierarchy: "Jerarquía",
      status: "Falta",
    },
    en: {
      filters: "Filters",
      cycle: "Cycle",
      department: "Department",
      manager: "Manager",
      groupBy: "Group by",
      hierarchy: "Hierarchy",
      status: "Missing",
    },
  }[locale];

  it("has the cycle, area and manager selects and toggles in the URL", () => {
    renderIn(
      locale,
      <CompletionFilters
        params={params}
        cycles={[
          { id: "c1", name: "2025-H1" },
          { id: "c0", name: "2024-H2" },
        ]}
        options={options}
        groupBys={["none", "department", "manager"]}
      />,
    );
    const form = screen.getByRole("form", { name: label.filters });
    const cycle = within(form).getByLabelText(label.cycle);
    expect(cycle).toHaveValue("c1");
    expect(
      within(cycle)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["2025-H1", "2024-H2"]);
    expect(within(form).getByLabelText(label.department)).toBeInTheDocument();
    expect(within(form).getByLabelText(label.manager)).toBeInTheDocument();

    const groupBy = screen.getByRole("group", { name: label.groupBy });
    expect(within(groupBy).getAllByRole("link")).toHaveLength(3);
    expect(
      within(groupBy)
        .getAllByRole("link")
        .find((l) => l.getAttribute("aria-current") === "true"),
    ).toHaveAttribute(
      "href",
      "/insights/completion?cycle=c1&groupBy=manager&hierarchy=asOf&status=any",
    );
    const hierarchy = screen.getByRole("group", { name: label.hierarchy });
    expect(within(hierarchy).getAllByRole("link")[1]).toHaveAttribute(
      "href",
      expect.stringContaining("hierarchy=current"),
    );
  });

  it("direction has no area or manager filter and no manager grouping", () => {
    renderIn(
      locale,
      <CompletionFilters
        params={parseCompletionParams({ cycle: "c1" })}
        cycles={[{ id: "c1", name: "2025-H1" }]}
        options={null}
        groupBys={["none", "department"]}
      />,
    );
    const form = screen.getByRole("form", { name: label.filters });
    expect(within(form).queryByLabelText(label.department)).toBeNull();
    expect(within(form).queryByLabelText(label.manager)).toBeNull();
    expect(
      within(screen.getByRole("group", { name: label.groupBy })).getAllByRole(
        "link",
      ),
    ).toHaveLength(2);
  });

  it("toggles the side that is missing", () => {
    renderIn(
      locale,
      <MissingStatusToggle
        params={parseCompletionParams({ cycle: "c1", status: "self_missing" })}
      />,
    );
    const group = screen.getByRole("group", { name: label.status });
    expect(within(group).getAllByRole("link")).toHaveLength(3);
    expect(
      within(group)
        .getAllByRole("link")
        .find((l) => l.getAttribute("aria-current") === "true"),
    ).toHaveAttribute("href", expect.stringContaining("status=self_missing"));
  });
});

describe("parseCompletionParams / completionHref", () => {
  it("defaults to the department grouping, the snapshot hierarchy and any status", () => {
    expect(parseCompletionParams({})).toEqual({
      cycle: undefined,
      groupBy: "department",
      hierarchy: "asOf",
      department: undefined,
      manager: undefined,
      status: "any",
    });
  });

  it("ignores values it does not know", () => {
    expect(
      parseCompletionParams({
        groupBy: "location",
        hierarchy: "never",
        status: "late",
      }),
    ).toMatchObject({
      groupBy: "department",
      hierarchy: "asOf",
      status: "any",
    });
  });

  it("builds links with the overrides and drops the empty ones", () => {
    const p = parseCompletionParams({ cycle: "c1", department: "Ventas" });
    expect(
      completionHref(p, { groupBy: "manager", department: undefined }),
    ).toBe(
      "/insights/completion?cycle=c1&groupBy=manager&hierarchy=asOf&status=any",
    );
  });
});
