import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { JobHistoryItem, OrgNode } from "@/modules/org-history/queries";
import { JobHistoryTable } from "./job-history-table";
import { OrgDatePicker } from "./org-date-picker";
import { OrgTree } from "./org-tree";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
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

const nodes: OrgNode[] = [
  {
    personId: "a",
    displayName: "Ana García",
    jobTitle: "CEO",
    department: "Dirección",
    parentId: null,
    depth: 0,
  },
  {
    personId: "c",
    displayName: "Carla Romero",
    jobTitle: "Engineering Manager",
    department: "Ingeniería",
    parentId: "a",
    depth: 1,
  },
  {
    personId: "b",
    displayName: "Bruno Pérez",
    jobTitle: "Developer",
    department: "Ingeniería",
    parentId: "c",
    depth: 2,
  },
];

describe("OrgTree", () => {
  it("nests reports under their manager", () => {
    renderIn("es", <OrgTree nodes={nodes} />);
    const tree = screen.getByRole("tree", { name: "Organigrama" });
    const carla = within(tree).getByRole("treeitem", { name: /Carla Romero/ });
    expect(
      within(carla).getByRole("treeitem", { name: /Bruno Pérez/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bruno Pérez" })).toHaveAttribute(
      "href",
      "/people/b",
    );
    expect(screen.getByText("Developer · Ingeniería")).toBeInTheDocument();
  });

  it("collapses and expands a subtree", async () => {
    renderIn("en", <OrgTree nodes={nodes} />);
    const toggle = screen.getByRole("button", {
      name: "Collapse Carla Romero",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "Expand Carla Romero" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Bruno Pérez" })).toBeNull();
  });

  it("shows an empty state in each locale", () => {
    renderIn("es", <OrgTree nodes={[]} />);
    expect(
      screen.getByText("No hay nadie en la organización en esa fecha."),
    ).toBeInTheDocument();
  });

  it("shows an empty state in English", () => {
    renderIn("en", <OrgTree nodes={[]} />);
    expect(
      screen.getByText("Nobody was in the organization on that date."),
    ).toBeInTheDocument();
  });
});

describe("OrgDatePicker", () => {
  it("is a GET form with the date prefilled", () => {
    renderIn("es", <OrgDatePicker date="2023-01-01" />);
    const input = screen.getByLabelText("Fecha");
    expect(input).toHaveValue("2023-01-01");
    expect(input).toHaveAttribute("name", "date");
    expect(input).toHaveAttribute("type", "date");
    expect(screen.getByRole("button", { name: "Ver" })).toBeInTheDocument();
  });

  it("labels in English", () => {
    renderIn("en", <OrgDatePicker date="2023-01-01" />);
    expect(screen.getByLabelText("Date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
  });
});

const history: JobHistoryItem[] = [
  {
    id: "2",
    validFrom: "2023-01-01",
    validTo: null,
    jobTitle: "Senior Developer",
    department: "Ingeniería",
    division: "Corporativo",
    location: "Rosario",
    managerPersonId: "a",
    managerName: "Ana García",
    managerRaw: "Ana García",
  },
  {
    id: "1",
    validFrom: "2021-07-15",
    validTo: "2023-01-01",
    jobTitle: "Developer",
    department: "Ingeniería",
    division: "Corporativo",
    location: "Rosario",
    managerPersonId: null,
    managerName: null,
    managerRaw: "Carla Romero",
  },
];

describe("JobHistoryTable", () => {
  it("lists each period with title, area and manager (es)", () => {
    renderIn("es", <JobHistoryTable rows={history} />);
    const table = screen.getByRole("table", { name: "Historial de puesto" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Puesto")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Área")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Actual")).toBeInTheDocument();
    expect(
      within(rows[1]).getByText("Ingeniería / Corporativo"),
    ).toBeInTheDocument();
    expect(
      within(rows[1]).getByRole("link", { name: "Ana García" }),
    ).toHaveAttribute("href", "/people/a");
    // Unresolved manager: the raw Bamboo name, flagged.
    expect(
      within(rows[2]).getByText("Carla Romero (sin resolver)"),
    ).toBeInTheDocument();
  });

  it("uses English labels", () => {
    renderIn("en", <JobHistoryTable rows={history} />);
    expect(
      screen.getByRole("table", { name: "Job history" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("shows an empty state", () => {
    renderIn("es", <JobHistoryTable rows={[]} />);
    expect(screen.getByText("Sin historial de puesto.")).toBeInTheDocument();
    renderIn("en", <JobHistoryTable rows={[]} />);
    expect(screen.getByText("No job history.")).toBeInTheDocument();
  });
});
