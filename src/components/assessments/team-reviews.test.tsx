import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { TeamReview } from "@/modules/review-capture";
import { TeamReviews } from "./team-reviews";

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

const item = (over: Partial<TeamReview> = {}): TeamReview => ({
  managerRequestId: "m1",
  managerStatus: "draft",
  shared: false,
  selfRequestId: "s1",
  selfState: "submitted",
  person: { id: "p1", name: "Bruno Díaz" },
  participantId: "cp1",
  cycleId: "c1",
  cycleName: "2026 H1",
  localizedName: null,
  periodEnd: "2026-06-30",
  dueDate: null,
  ...over,
});

const renderIn = (locale: "es" | "en", ui: ReactNode) =>
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "es" ? es : en}
      timeZone="UTC"
    >
      {ui}
    </NextIntlClientProvider>,
  );

describe("TeamReviews", () => {
  it("shows a card per direct report linking to the manager form", () => {
    renderIn("en", <TeamReviews items={[item()]} />);
    const card = screen.getByRole("article");
    expect(within(card).getByText("Bruno Díaz")).toBeTruthy();
    expect(
      within(card)
        .getByRole("link", { name: "Write review" })
        .getAttribute("href"),
    ).toBe("/assessments/requests/m1");
  });

  it("says whether a submitted review was shared", () => {
    renderIn(
      "es",
      <TeamReviews
        items={[item({ managerStatus: "submitted", shared: true })]}
      />,
    );
    expect(screen.getByText("Compartida")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver evaluación" })).toBeTruthy();
  });

  it("renders nothing without a team", () => {
    const { container } = renderIn("en", <TeamReviews items={[]} />);
    expect(container.textContent).toBe("");
  });
});
