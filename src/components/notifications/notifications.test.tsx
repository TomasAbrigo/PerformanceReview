import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type { NotificationItem } from "@/modules/notifications";
import { InboxView } from "./inbox-view";
import { NotificationBadge } from "./notification-badge";
import { NotificationsPreview } from "./notifications-preview";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
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

const CYCLE = "00000000-0000-4000-8000-0000000000c1";

let seq = 0;
function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    kind: "reminder_due",
    cycleId: CYCLE,
    requestId: null,
    payload: {
      cycleName: "H1 2022",
      dueDate: "2022-07-15",
      daysLeft: 7,
      relationship: "self",
    },
    createdAt: new Date("2022-07-08T12:00:00Z"),
    readAt: null,
    ...overrides,
  };
}

const noop = async () => ({ ok: true as const });

function inbox(
  items: NotificationItem[],
  props: Partial<ComponentProps<typeof InboxView>> = {},
) {
  return (
    <InboxView
      hasPerson
      items={items}
      nextCursor={null}
      markRead={noop}
      markAllRead={noop}
      {...props}
    />
  );
}

describe("InboxView", () => {
  it.each([
    ["es", "Notificaciones", "No tenés notificaciones."],
    ["en", "Notifications", "You have no notifications."],
  ] as const)("shows the empty state in %s", (locale, title, empty) => {
    renderIn(locale, inbox([]));
    expect(
      screen.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    expect(screen.getByText(empty)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks to pick a person when acting without one", () => {
    renderIn("es", inbox([], { hasPerson: false }));
    expect(screen.getByText(/Elegí una persona/)).toBeVisible();
  });

  it.each([
    [
      "es",
      "Tu autoevaluación del ciclo H1 2022 vence en 7 días (15 jul 2022).",
      "Abrir",
    ],
    [
      "en",
      "Your self assessment for H1 2022 is due in 7 days (Jul 15, 2022).",
      "Open",
    ],
  ] as const)(
    "renders a reminder from kind and payload in %s",
    (locale, text, open) => {
      renderIn(locale, inbox([item()]));
      const row = screen.getByRole("listitem");
      expect(within(row).getByText(text)).toBeVisible();
      expect(within(row).getByRole("link", { name: open })).toHaveAttribute(
        "href",
        `/cycles/${CYCLE}/self`,
      );
    },
  );

  it.each([
    [0, "vence hoy", "is due today"],
    [1, "vence mañana", "is due tomorrow"],
  ])("says when %d days are left", (daysLeft, es, en) => {
    const payload = {
      cycleName: "H1",
      dueDate: "2022-07-15",
      daysLeft,
      relationship: "self" as const,
    };
    renderIn("es", inbox([item({ payload })]));
    expect(screen.getByText(new RegExp(es))).toBeVisible();
    renderIn("en", inbox([item({ payload })]));
    expect(screen.getByText(new RegExp(en))).toBeVisible();
  });

  it("renders the other kinds", () => {
    renderIn(
      "es",
      inbox([
        item({
          kind: "manual_reminder",
          payload: {
            cycleName: "H1",
            relationship: "manager",
            participantName: "Carla Romero",
            senderName: "Ana García",
            dueDate: "2022-08-01",
          },
        }),
        item({
          kind: "manual_reminder",
          payload: { cycleName: "H1", relationship: "self", senderName: null },
        }),
        item({
          kind: "cycle_phase_changed",
          payload: {
            cycleName: "H1",
            fromStatus: "collecting",
            toStatus: "manager_review",
          },
        }),
        item({
          kind: "cycle_phase_changed",
          payload: {
            cycleName: "H1",
            fromStatus: "draft",
            toStatus: "collecting",
          },
        }),
        item({
          kind: "review_shared",
          payload: { cycleName: "H1", senderName: "Ana García" },
        }),
        item({ kind: "feedback_received", payload: { cycleName: "H1" } }),
        item({ kind: "calibration_published", payload: { cycleName: "H1" } }),
      ]),
    );
    expect(
      screen.getByText(
        "Ana García te recuerda completar tu evaluación de Carla Romero del ciclo H1 (vence el 1 ago 2022).",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "El equipo de People te recuerda completar tu autoevaluación del ciclo H1.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "El ciclo H1 pasó de la fase Recolección a la fase Revisión del manager.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("El ciclo H1 se lanzó y está en la fase Recolección."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Tu evaluación del ciclo H1 fue compartida con vos por Ana García.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Recibiste feedback nuevo en el ciclo H1."),
    ).toBeVisible();
    expect(
      screen.getByText("Se publicó la calibración del ciclo H1."),
    ).toBeVisible();
  });

  it("separates unread from read, unread first", () => {
    renderIn(
      "es",
      inbox([
        item({ kind: "feedback_received", payload: { cycleName: "Ciclo A" } }),
        item({
          kind: "feedback_received",
          payload: { cycleName: "Ciclo B" },
          readAt: new Date("2022-07-09T00:00:00Z"),
        }),
      ]),
    );
    const unread = screen.getByRole("region", { name: "No leídas" });
    const read = screen.getByRole("region", { name: "Leídas" });
    expect(within(unread).getByText(/Ciclo A/)).toBeVisible();
    expect(within(read).getByText(/Ciclo B/)).toBeVisible();
    // Only unread ones can be marked.
    expect(
      within(unread).getByRole("button", { name: "Marcar como leída" }),
    ).toBeVisible();
    expect(within(read).queryByRole("button")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Marcar todas como leídas" }),
    ).toBeVisible();
  });

  it("hides mark all when everything is read", () => {
    renderIn("en", inbox([item({ readAt: new Date("2022-07-09T00:00:00Z") })]));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("region", { name: "Unread" })).toBeNull();
  });

  it("marks one notification read", async () => {
    const markRead = vi.fn(noop);
    const first = item();
    renderIn("es", inbox([first, item()], { markRead }));
    await userEvent.click(
      screen.getAllByRole("button", { name: "Marcar como leída" })[0],
    );
    expect(markRead).toHaveBeenCalledWith([first.id]);
  });

  it("marks all read", async () => {
    const markAllRead = vi.fn(noop);
    renderIn("es", inbox([item(), item()], { markAllRead }));
    await userEvent.click(
      screen.getByRole("button", { name: "Marcar todas como leídas" }),
    );
    expect(markAllRead).toHaveBeenCalledTimes(1);
  });

  it("reports a failed update", async () => {
    renderIn(
      "es",
      inbox([item()], {
        markAllRead: async () => ({
          ok: false as const,
          code: "unknown",
          issues: [],
        }),
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Marcar todas como leídas" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudo actualizar la bandeja.",
      ),
    );
  });

  it("links to older notifications and back to the start", () => {
    renderIn("es", inbox([item()], { nextCursor: "abc" }));
    expect(
      screen.getByRole("link", { name: "Ver más antiguas" }),
    ).toHaveAttribute("href", "/inbox?cursor=abc");
  });

  it("offers a way back to the start on a later page", () => {
    renderIn("es", inbox([item()], { isFirstPage: false }));
    expect(
      screen.getByRole("link", { name: "Volver al inicio" }),
    ).toHaveAttribute("href", "/inbox");
  });
});

describe("NotificationBadge", () => {
  it.each([
    ["es", 3, "Notificaciones: 3 sin leer"],
    ["en", 3, "Notifications: 3 unread"],
    ["es", 1, "Notificaciones: 1 sin leer"],
    ["es", 0, "Notificaciones: ninguna sin leer"],
  ] as const)(
    "is a link to the inbox named for screen readers (%s, %d)",
    (locale, count, name) => {
      renderIn(locale, <NotificationBadge count={count} />);
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "href",
        "/inbox",
      );
    },
  );

  it("shows the number only when there is something unread", () => {
    const { unmount } = renderIn("es", <NotificationBadge count={0} />);
    expect(screen.queryByText("0")).toBeNull();
    unmount();
    renderIn("es", <NotificationBadge count={3} />);
    expect(screen.getByText("3")).toBeVisible();
  });

  it("caps the number at 99+", () => {
    renderIn("es", <NotificationBadge count={250} />);
    expect(screen.getByText("99+")).toBeVisible();
  });
});

describe("NotificationsPreview", () => {
  it("renders nothing when there is nothing unread", () => {
    const { container } = renderIn(
      "es",
      <NotificationsPreview items={[]} unread={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["es", "Notificaciones nuevas", "Ver todas (5)"],
    ["en", "New notifications", "View all (5)"],
  ] as const)(
    "lists the latest unread and links to the inbox in %s",
    (locale, title, all) => {
      renderIn(
        locale,
        <NotificationsPreview items={[item(), item(), item()]} unread={5} />,
      );
      expect(screen.getByRole("heading", { name: title })).toBeVisible();
      expect(screen.getAllByRole("listitem")).toHaveLength(3);
      expect(screen.getByRole("link", { name: all })).toHaveAttribute(
        "href",
        "/inbox",
      );
    },
  );
});
