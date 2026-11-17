import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { actorRoles } from "@/modules/actor/types";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { PeopleList } from "./people-list";
import { PersonDetail } from "./person-detail";

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

const people = [
  {
    id: "p1",
    displayName: "Ana García",
    workEmail: "ana.garcia@example.com",
    status: "Active",
  },
  {
    id: "p2",
    displayName: "Carla Romero",
    workEmail: "carla.romero@example.com",
    status: "Inactive",
  },
];

const detail = {
  id: "p2",
  displayName: "Carla Romero",
  workEmail: "carla.romero@example.com",
  identities: [
    {
      kind: "bamboo_id" as const,
      value: "103",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: null,
    },
    {
      kind: "employee_number" as const,
      value: "0003",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: null,
    },
    {
      kind: "work_email" as const,
      value: "carla.romero@example.com",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validTo: null,
    },
  ],
  employments: [
    {
      id: "e1",
      hireDate: "2018-01-10",
      terminationDate: "2024-06-30",
      status: "Inactive",
    },
  ],
};

describe("PeopleList", () => {
  it.each([
    ["es", "Personas", "Activo", "Inactivo", "2 personas"],
    ["en", "People", "Active", "Inactive", "2 people"],
  ] as const)(
    "renders rows with status badges in %s",
    (locale, heading, active, inactive, total) => {
      renderIn(locale, <PeopleList people={people} query="" />);

      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(screen.getByText(total)).toBeInTheDocument();
      const rows = screen.getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByText(active)).toBeInTheDocument();
      expect(within(rows[1]).getByText(inactive)).toBeInTheDocument();
      expect(
        within(rows[0]).getByRole("link", { name: "Ana García" }),
      ).toHaveAttribute("href", "/people/p1");
      expect(screen.getByRole("searchbox")).toBeInTheDocument();
    },
  );

  it.each([
    ["es", "No hay personas para mostrar."],
    ["en", "No people to show."],
  ] as const)("shows the empty state in %s", (locale, empty) => {
    renderIn(locale, <PeopleList people={[]} query="" />);
    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it.each([
    ["es", "Buscar por nombre"],
    ["en", "Search by name"],
  ] as const)(
    "shows no email anywhere and searches by name only in %s",
    (locale, label) => {
      renderIn(locale, <PeopleList people={people} query="" />);
      expect(screen.queryByText(/@/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("columnheader", { name: /e-?mail/i }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole("columnheader")).toHaveLength(2);
      expect(
        screen.getByRole("searchbox", { name: label }),
      ).toBeInTheDocument();
      expect(screen.getByRole("searchbox")).not.toHaveAttribute(
        "placeholder",
        expect.stringMatching(/e-?mail/i),
      );
    },
  );

  it("keeps the current query in the search box", () => {
    renderIn("es", <PeopleList people={[]} query="ana" />);
    expect(screen.getByRole("searchbox")).toHaveValue("ana");
  });
});

describe("PersonDetail", () => {
  it.each([
    ["es", "ID Bamboo", "Legajo", "Email", "Períodos de empleo", "Inactivo"],
    [
      "en",
      "Bamboo ID",
      "Employee number",
      "Email",
      "Employment periods",
      "Inactive",
    ],
  ] as const)(
    "shows identities and employment periods in %s",
    (locale, bambooId, legajo, email, periods, inactive) => {
      renderIn(locale, <PersonDetail person={detail} role="hr" />);

      expect(
        screen.getByRole("heading", { level: 1, name: "Carla Romero" }),
      ).toBeInTheDocument();
      const ids = screen.getByRole("table", { name: /identi/i });
      expect(within(ids).getByText(bambooId)).toBeInTheDocument();
      expect(within(ids).getByText("103")).toBeInTheDocument();
      expect(within(ids).getByText(legajo)).toBeInTheDocument();
      expect(within(ids).getByText("0003")).toBeInTheDocument();
      expect(within(ids).getByText(email)).toBeInTheDocument();
      expect(screen.getByText(periods)).toBeInTheDocument();
      const emp = screen.getByRole("table", { name: periods });
      expect(within(emp).getByText("2018-01-10")).toBeInTheDocument();
      expect(within(emp).getByText("2024-06-30")).toBeInTheDocument();
      expect(within(emp).getByText(inactive)).toBeInTheDocument();
    },
  );
});

describe("PersonDetail email visibility", () => {
  const email = "carla.romero@example.com";

  it("shows the work email, in the heading and as an identity, to People (hr)", () => {
    renderIn("es", <PersonDetail person={detail} role="hr" />);
    // Once under the name, once among the source identifiers.
    expect(screen.getAllByText(email)).toHaveLength(2);
  });

  it.each(actorRoles.filter((role) => role !== "hr"))(
    "shows no email at all to the %s role, the rest of the sheet intact",
    (role) => {
      renderIn("es", <PersonDetail person={detail} role={role} />);
      expect(screen.queryByText(/@/)).not.toBeInTheDocument();
      expect(screen.queryByText(email)).not.toBeInTheDocument();
      const ids = screen.getByRole("table", { name: /identi/i });
      expect(within(ids).queryByText("Email")).not.toBeInTheDocument();
      expect(within(ids).getByText("103")).toBeInTheDocument();
      expect(within(ids).getByText("0003")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 1, name: "Carla Romero" }),
      ).toBeInTheDocument();
    },
  );
});
