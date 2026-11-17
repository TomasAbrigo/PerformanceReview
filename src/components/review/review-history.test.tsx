import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { type HistoryItemView, ReviewHistory } from "./review-history";
import type { ReviewData } from "./read-only-answers";

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

const reviewData = (
  prompt: { es: string; en: string },
  answer: string,
): ReviewData => ({
  requestId: "r",
  cycleName: "H1 2022",
  dueDate: null,
  status: "submitted",
  submittedAt: new Date("2022-07-01T00:00:00Z"),
  questions: [
    {
      id: "q",
      sectionTitle: { es: "Sección", en: "Section" },
      prompt,
      kind: "text",
      required: true,
      scale: null,
      choices: null,
    },
  ],
  answers: { q: answer },
});

function item(overrides: Partial<HistoryItemView> = {}): HistoryItemView {
  return {
    participantId: "p1",
    cycleId: "c1",
    cycleName: "H1 2022",
    periodStart: "2022-01-01",
    periodEnd: "2022-06-30",
    cycleStatus: "closed",
    managerPersonId: "m1",
    managerName: "Carla Romero",
    jobTitle: "Developer",
    department: "Ingeniería",
    sharedAt: new Date("2022-07-10T12:00:00Z"),
    rating: {
      value: 3,
      label: { es: "Cumple", en: "Meets" },
      normalized: 2 / 3,
    },
    self: reviewData(
      { es: "¿Qué lograste?", en: "What did you achieve?" },
      "Mucho",
    ),
    manager: reviewData(
      { es: "¿Cómo le fue?", en: "How did they do?" },
      "Muy bien",
    ),
    ...overrides,
  };
}

describe("ReviewHistory", () => {
  it("says there is nothing yet (es)", () => {
    renderIn("es", <ReviewHistory personName="Bruno Pérez" items={[]} />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Evaluaciones de Bruno Pérez",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Todavía no hay evaluaciones finalizadas ni compartidas.",
      ),
    ).toBeVisible();
  });

  it("shows each cycle with the manager and job of that moment, rating and states (es)", () => {
    renderIn("es", <ReviewHistory personName="Bruno Pérez" items={[item()]} />);
    const card = screen.getByRole("article", { name: "H1 2022" });
    expect(within(card).getByText("1 ene 2022 a 30 jun 2022")).toBeVisible();
    expect(
      within(card).getByText("Manager en ese momento: Carla Romero"),
    ).toBeVisible();
    expect(
      within(card).getByText(
        "Puesto y área en ese momento: Developer, Ingeniería",
      ),
    ).toBeVisible();
    expect(within(card).getByText("Cumple (67%)")).toBeVisible();
    expect(within(card).getByText("Compartida el 10 jul 2022")).toBeVisible();
  });

  it("includes the readable answers of both reviews", async () => {
    const user = userEvent.setup();
    renderIn("es", <ReviewHistory personName="Bruno Pérez" items={[item()]} />);
    await user.click(screen.getByText("Ver respuestas"));
    expect(screen.getByText("¿Qué lograste?")).toBeVisible();
    expect(screen.getByText("Mucho")).toBeVisible();
    expect(screen.getByText("¿Cómo le fue?")).toBeVisible();
    expect(screen.getByText("Muy bien")).toBeVisible();
  });

  it("renders a cycle without rating, sharing or manager review (en)", () => {
    renderIn(
      "en",
      <ReviewHistory
        personName="Bruno Pérez"
        items={[
          item({
            cycleName: "H1 2024",
            managerName: null,
            jobTitle: null,
            department: null,
            rating: null,
            sharedAt: null,
            manager: null,
          }),
        ]}
      />,
    );
    const card = screen.getByRole("article", { name: "H1 2024" });
    expect(within(card).getByText("No manager at the time")).toBeVisible();
    expect(within(card).getByText("No rating")).toBeVisible();
    expect(within(card).getByText("Not shared")).toBeVisible();
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    expect(within(card).queryByText("Manager review")).not.toBeInTheDocument();
  });

  it("lists cycles in the given order", () => {
    renderIn(
      "es",
      <ReviewHistory
        personName="Bruno Pérez"
        items={[
          item({ participantId: "a", cycleName: "H1 2024" }),
          item({ participantId: "b", cycleName: "H1 2022" }),
        ]}
      />,
    );
    expect(
      screen.getAllByRole("article").map((a) => a.getAttribute("aria-label")),
    ).toEqual(["H1 2024", "H1 2022"]);
  });
});
