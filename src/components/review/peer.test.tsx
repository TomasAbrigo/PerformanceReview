import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { NominationsApprovals } from "./nominations-approvals";
import {
  NominationsPicker,
  type NominationsPickerData,
} from "./nominations-picker";
import {
  PeerFeedbackView,
  type PeerFeedbackViewItem,
} from "./peer-feedback-view";
import { PeerReviewForm } from "./peer-review-form";
import type { SelfReviewData } from "./self-review-form";

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

const ok = async () => ({ ok: true as const });

function picker(
  overrides: Partial<NominationsPickerData> = {},
): NominationsPickerData {
  return {
    participantId: "p1",
    cycleName: "H1 2026",
    canEdit: true,
    max: 2,
    nominations: [],
    candidates: [
      {
        personId: "d",
        displayName: "Dani",
        openRequests: 0,
        overloaded: false,
      },
      { personId: "e", displayName: "Eva", openRequests: 6, overloaded: true },
    ],
    ...overrides,
  };
}

describe("NominationsPicker", () => {
  it("shows the empty state and nominates (es)", async () => {
    const nominate = vi.fn(ok);
    renderIn(
      "es",
      <NominationsPicker
        data={picker()}
        actions={{ nominate, remove: vi.fn(ok) }}
      />,
    );
    expect(screen.getByText("Todavía no nominaste a nadie.")).toBeTruthy();
    expect(screen.getByText("0 de 2 nominaciones")).toBeTruthy();
    await userEvent.selectOptions(
      screen.getByLabelText("Colega a nominar"),
      "d",
    );
    await userEvent.click(screen.getByRole("button", { name: "Nominar" }));
    await waitFor(() => expect(nominate).toHaveBeenCalledWith("p1", "d"));
  });

  it("warns about overloaded candidates and nominations (en)", async () => {
    renderIn(
      "en",
      <NominationsPicker
        data={picker({
          nominations: [
            {
              id: "n1",
              nomineePersonId: "e",
              nomineeName: "Eva",
              status: "pending",
              openRequests: 6,
              overloaded: true,
            },
          ],
        })}
        actions={{ nominate: vi.fn(ok), remove: vi.fn(ok) }}
      />,
    );
    expect(screen.getByText("High load")).toBeTruthy();
    expect(screen.getByText("6 open requests")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("adapts the intro when no approval is needed (en)", () => {
    renderIn(
      "en",
      <NominationsPicker
        data={picker({ approval: "none" })}
        actions={{ nominate: vi.fn(ok), remove: vi.fn(ok) }}
      />,
    );
    expect(screen.getByText(/Nominations need no approval/)).toBeTruthy();
  });

  it("disables nominating at the cap (es)", () => {
    const n = (id: string, name: string) => ({
      id,
      nomineePersonId: id,
      nomineeName: name,
      status: "approved" as const,
      openRequests: 1,
      overloaded: false,
    });
    renderIn(
      "es",
      <NominationsPicker
        data={picker({ nominations: [n("a", "Ana"), n("b", "Beto")] })}
        actions={{ nominate: vi.fn(ok), remove: vi.fn(ok) }}
      />,
    );
    expect(
      screen.getByText("Llegaste al máximo de nominaciones."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nominar" })).toBeNull();
  });
});

describe("NominationsApprovals", () => {
  const items = [
    {
      id: "n1",
      cycleId: "c",
      cycleName: "H1",
      participantId: "p",
      revieweeName: "Bruno",
      nomineeName: "Dani",
      openRequests: 0,
      overloaded: false,
    },
    {
      id: "n2",
      cycleId: "c",
      cycleName: "H1",
      participantId: "p",
      revieweeName: "Bruno",
      nomineeName: "Eva",
      openRequests: 7,
      overloaded: true,
    },
  ];

  it("approves individually and in bulk (es)", async () => {
    const decide = vi.fn(ok);
    renderIn("es", <NominationsApprovals items={items} decide={decide} />);
    expect(screen.getByText("Mucha carga")).toBeTruthy();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Rechazar" })[1],
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(["n2"], "declined"),
    );
    await userEvent.click(
      screen.getByLabelText("Seleccionar a Dani para Bruno"),
    );
    await userEvent.click(
      screen.getByLabelText("Seleccionar a Eva para Bruno"),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Aprobar seleccionadas" }),
    );
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(["n1", "n2"], "approved"),
    );
  });

  it("shows the empty state (en)", () => {
    renderIn("en", <NominationsApprovals items={[]} decide={vi.fn(ok)} />);
    expect(screen.getByText("No pending nominations.")).toBeTruthy();
  });
});

const review: SelfReviewData = {
  requestId: "r1",
  cycleName: "H1 2026",
  dueDate: null,
  status: "draft",
  submittedAt: null,
  canWrite: true,
  questions: [
    {
      id: "q1",
      sectionTitle: { es: "Pares", en: "Peers" },
      prompt: { es: "¿Qué hace bien?", en: "What does well?" },
      kind: "text",
      required: true,
      scale: null,
      choices: null,
    },
  ],
  answers: {},
};

describe("PeerReviewForm", () => {
  it("titles the form and declines with a reason (es)", async () => {
    const decline = vi.fn(ok);
    renderIn(
      "es",
      <PeerReviewForm
        review={review}
        revieweeName="Bruno"
        relationship="peer"
        anonymity="anonymous_to_employee"
        actions={{ save: vi.fn(ok), submit: vi.fn(ok), decline }}
      />,
    );
    expect(screen.getByText("Feedback para Bruno")).toBeTruthy();
    expect(
      screen.getByText(
        /verá tu feedback como "Par", sin tu nombre; su manager y People sí ven tu nombre/,
      ),
    ).toBeTruthy();
    await userEvent.type(
      screen.getByLabelText("Motivo"),
      "No trabajamos juntos",
    );
    await userEvent.click(screen.getByRole("button", { name: "Declinar" }));
    await waitFor(() =>
      expect(decline).toHaveBeenCalledWith("r1", "No trabajamos juntos"),
    );
  });

  it("uses the upward title (en)", () => {
    renderIn(
      "en",
      <PeerReviewForm
        review={review}
        revieweeName="Carla"
        relationship="upward"
        anonymity="transparent"
        actions={{ save: vi.fn(ok), submit: vi.fn(ok), decline: vi.fn(ok) }}
      />,
    );
    expect(screen.getByText("Feedback for your manager Carla")).toBeTruthy();
    expect(
      screen.getByText(
        "Your name will be visible to the reviewee, their manager and People.",
      ),
    ).toBeTruthy();
  });
});

describe("PeerFeedbackView", () => {
  const item = (
    reviewerName: string | null,
    reviewerVisible: boolean,
  ): PeerFeedbackViewItem => ({
    requestId: "r1",
    relationship: "peer",
    reviewerName,
    reviewerVisible,
    questions: review.questions,
    answers: { q1: "Muy colaborativa" },
  });

  it("transparent: shows the reviewer's name (es)", () => {
    renderIn("es", <PeerFeedbackView items={[item("Dani", true)]} />);
    expect(screen.getByText("Dani")).toBeTruthy();
    expect(screen.getByText("Muy colaborativa")).toBeTruthy();
  });

  it("anonymous to employee: labels it Par (es)", () => {
    renderIn("es", <PeerFeedbackView items={[item(null, false)]} />);
    expect(screen.getByText("Par")).toBeTruthy();
    expect(screen.queryByText("Dani")).toBeNull();
  });

  it("fully anonymous: labels it Peer (en)", () => {
    renderIn("en", <PeerFeedbackView items={[item(null, false)]} />);
    expect(screen.getByText("Peer")).toBeTruthy();
    expect(screen.getByText("What does well?")).toBeTruthy();
  });

  it("empty (en)", () => {
    renderIn("en", <PeerFeedbackView items={[]} />);
    expect(screen.getByText("There is no peer feedback to show.")).toBeTruthy();
  });
});
