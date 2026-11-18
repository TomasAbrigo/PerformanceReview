import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { noOrgOptions } from "@/modules/org-attributes/kinds";
import { OrgFilterFields } from "./org-filter-fields";
import { orgFiltersOf, parseOrgParams } from "./params";

const messages = { es, en };
const renderIn = (locale: "es" | "en", ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      <form>{ui}</form>
    </NextIntlClientProvider>,
  );

const options = {
  accounts: ["Cuenta A", "Cuenta B"],
  projects: ["Proyecto A1"],
  dms: ["Diego", "Dora"],
  santexLeads: ["Lía"],
};

describe("parseOrgParams", () => {
  it("reads the four cuts, trimmed, an empty value is none", () => {
    expect(
      parseOrgParams({
        account: " Cuenta A ",
        project: "",
        dm: ["Diego", "Dora"],
        santexLead: undefined,
      }),
    ).toEqual({
      account: "Cuenta A",
      project: undefined,
      dm: "Diego",
      santexLead: undefined,
    });
  });

  it("hands the modules the same filters", () => {
    expect(orgFiltersOf({ account: "A", dm: "D" })).toEqual({
      account: "A",
      project: undefined,
      dm: "D",
      santexLead: undefined,
    });
  });
});

describe("OrgFilterFields", () => {
  it.each([
    ["es", ["Cuenta", "Proyecto", "DM", "Santex Lead"], "Todas"],
    ["en", ["Account", "Project", "DM", "Santex Lead"], "All"],
  ] as const)(
    "one select per cut with its values, in %s",
    (locale, labels, any) => {
      renderIn(locale, <OrgFilterFields params={{}} options={options} />);

      for (const label of labels) {
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
      const account = screen.getByLabelText(labels[0]) as HTMLSelectElement;
      expect(account.name).toBe("account");
      expect([...account.options].map((o) => o.text)).toEqual([
        any,
        "Cuenta A",
        "Cuenta B",
      ]);
      expect((screen.getByLabelText(labels[3]) as HTMLSelectElement).name).toBe(
        "santexLead",
      );
    },
  );

  it("selects what the URL says, even a value that is not on offer any more", () => {
    renderIn(
      "es",
      <OrgFilterFields
        params={{ account: "Cuenta B", dm: "Ex DM" }}
        options={options}
      />,
    );

    expect(screen.getByLabelText("Cuenta")).toHaveValue("Cuenta B");
    const dm = screen.getByLabelText("DM") as HTMLSelectElement;
    expect(dm).toHaveValue("Ex DM");
    expect([...dm.options].map((o) => o.text)).toEqual([
      "Todas",
      "Ex DM",
      "Diego",
      "Dora",
    ]);
  });

  it("leaves out the cuts with nothing to offer (and everything without options)", () => {
    const { container, rerender } = renderIn(
      "es",
      <OrgFilterFields
        params={{}}
        options={{ ...noOrgOptions, accounts: ["Cuenta A"] }}
      />,
    );
    expect(container.querySelectorAll("select")).toHaveLength(1);
    expect(screen.queryByLabelText("DM")).toBeNull();

    rerender(
      <NextIntlClientProvider locale="es" messages={es}>
        <form>
          <OrgFilterFields params={{}} options={null} />
        </form>
      </NextIntlClientProvider>,
    );
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });
});
