import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const getActor = vi.fn();
vi.mock("@/modules/actor/server", () => ({ getActor: () => getActor() }));

const { HrOnly } = await import("./hr-only");
const { NoAccess } = await import("./no-access");

const renderIn = (locale: "es" | "en", ui: ReactNode) =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "es" ? es : en}
    >
      {ui}
    </NextIntlClientProvider>,
  );

beforeEach(() => getActor.mockReset());

describe("NoAccess", () => {
  it("says there is no access, in both languages, and links home", () => {
    const { unmount } = renderIn("es", <NoAccess />);
    expect(screen.getByRole("heading", { name: "Sin acceso" })).toBeVisible();
    expect(
      screen.getByText(/solo para People \(RR\. HH\.\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Volver al inicio" }),
    ).toHaveAttribute("href", "/");
    unmount();
    renderIn("en", <NoAccess />);
    expect(screen.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});

describe("HrOnly", () => {
  it("renders its children for People", async () => {
    getActor.mockResolvedValue({ personId: null, role: "hr" });
    renderIn("es", await HrOnly({ children: <p>Corridas</p> }));
    expect(screen.getByText("Corridas")).toBeVisible();
    expect(screen.queryByText("Sin acceso")).toBeNull();
  });

  it.each(["manager", "employee", "direction"] as const)(
    "shows no access instead of the children for %s",
    async (role) => {
      getActor.mockResolvedValue({ personId: null, role });
      renderIn("es", await HrOnly({ children: <p>Corridas</p> }));
      expect(screen.queryByText("Corridas")).toBeNull();
      expect(screen.getByRole("heading", { name: "Sin acceso" })).toBeVisible();
    },
  );
});
