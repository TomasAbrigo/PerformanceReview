import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { NavGroup } from "./nav-items";

let pathname = "/";
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
  usePathname: () => pathname,
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const { SideNavClient } = await import("./side-nav-client");

const item = (key: string, href: string, label: string) =>
  ({ key, href, label, description: "" }) as NavGroup["items"][number];
const groups: NavGroup[] = [
  {
    key: "goals",
    title: "Goals",
    primary: true,
    items: [item("goalsArea", "/goals", "Goals")],
  },
  {
    key: "assessments",
    title: "Assessments",
    primary: true,
    items: [item("assessmentsArea", "/assessments", "Assessments")],
  },
  {
    key: "insights",
    title: "Análisis",
    primary: false,
    items: [
      item("executive", "/insights/executive", "Vista ejecutiva"),
      item("completion", "/insights/completion", "Completitud"),
    ],
  },
  {
    key: "data",
    title: "Datos",
    primary: false,
    items: [item("upload", "/imports/upload", "Subir archivo")],
  },
];

const renderNav = (path: string) => {
  pathname = path;
  return render(
    <SideNavClient
      groups={groups}
      label="Secciones"
      product="Performance"
      home="Inicio"
      people="Personas"
      menu="Menú"
      company="Santex Group"
      tagline="yes, it's possible"
    />,
  );
};
const nav = () => screen.getByRole("navigation", { name: "Secciones" });

describe("SideNavClient", () => {
  it("lists Inicio, then Goals and Assessments, then the sections in order", () => {
    renderNav("/");
    expect(
      within(nav())
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual([
      "Performance", // the wordmark (named by its aria-label) and the product kicker
      "Inicio",
      "Goals",
      "Assessments",
      "Vista ejecutiva",
      "Completitud",
      "Subir archivo",
    ]);
  });

  it("labels each section: Personas holds Goals and Assessments, apart from the analysis", () => {
    renderNav("/");
    expect(
      within(nav())
        .getAllByText(/^(Personas|Análisis|Datos)$/)
        .filter((el) => el.tagName === "P")
        .map((el) => el.textContent),
    ).toEqual(["Personas", "Análisis", "Datos"]);
  });

  it("marks the current section, nested pages included, and only it", () => {
    renderNav("/assessments/c1/p1");
    const current = within(nav())
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Assessments"]);
  });

  it("marks Inicio on the home", () => {
    renderNav("/");
    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens and closes the menu on narrow screens from its button", () => {
    renderNav("/goals");
    const button = screen.getByRole("button", { name: "Menú" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses the sections on narrow screens, the current one starting open", () => {
    renderNav("/insights/completion");
    const analysis = screen.getByRole("button", { name: "Análisis" });
    const data = screen.getByRole("button", { name: "Datos" });
    expect(analysis).toHaveAttribute("aria-expanded", "true");
    expect(data).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(data);
    expect(data).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(analysis);
    expect(analysis).toHaveAttribute("aria-expanded", "false");
  });
});
