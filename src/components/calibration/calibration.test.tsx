import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import type {
  CalibrationTable,
  Distribution,
} from "@/modules/review-core/calibration";
import { CalibrationTableView } from "./calibration-table";
import { DistributionChart, type DistributionData } from "./distribution-chart";
import { PublishCalibration } from "./publish-calibration";

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

const P = "00000000-0000-4000-8000-0000000000b1";
const scale = [
  { value: 1, label: { es: "Bajo", en: "Low" }, normalized: 0 },
  { value: 2, label: { es: "Alto", en: "High" }, normalized: 1 },
];

function table(overrides: Partial<CalibrationTable> = {}): CalibrationTable {
  return {
    group: { id: "g", cycleId: "c", name: "Ventas", kind: "by_department" },
    canEdit: true,
    publishedAt: null,
    scale,
    rows: [
      {
        participantId: P,
        revieweeName: "Bruno Pérez",
        managerName: "Carla Romero",
        department: "Ventas",
        managerRating: { value: 1, label: scale[0].label, stage: "manager" },
        currentRating: { value: 2, label: scale[1].label, stage: "calibrated" },
        flagged: true,
        history: [
          {
            stage: "calibrated",
            value: 2,
            reason: "Impacto",
            createdAt: new Date("2026-01-01"),
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("CalibrationTableView", () => {
  it("shows the empty state (es)", () => {
    renderIn(
      "es",
      <CalibrationTableView table={table({ rows: [] })} propose={vi.fn()} />,
    );
    expect(
      screen.getByText("Este grupo no tiene participantes."),
    ).toBeInTheDocument();
  });

  it("shows original next to current and requires a reason (en)", async () => {
    const propose = vi.fn().mockResolvedValue({ ok: true });
    renderIn("en", <CalibrationTableView table={table()} propose={propose} />);
    const row = screen.getByRole("row", { name: /Bruno Pérez/ });
    expect(within(row).getAllByRole("cell")[2]).toHaveTextContent("1 · Low");
    expect(within(row).getAllByRole("cell")[3]).toHaveTextContent("2 · High");
    expect(within(row).getByText("To discuss")).toBeInTheDocument();
    expect(within(row).getByText(/Impacto/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save change" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A reason is required.",
    );
    expect(propose).not.toHaveBeenCalled();
    await userEvent.type(
      screen.getByPlaceholderText("Reason for the change (required)"),
      "Calibrated",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save change" }));
    await waitFor(() =>
      expect(propose).toHaveBeenCalledWith({
        participantId: P,
        value: 2,
        reason: "Calibrated",
        flag: false,
      }),
    );
  });

  it("is read-only for calibrators (es)", () => {
    renderIn(
      "es",
      <CalibrationTableView
        table={table({ canEdit: false })}
        propose={vi.fn()}
      />,
    );
    expect(screen.getByText("Solo lectura")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar cambio" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

const dist = (counts: number[]): Distribution => ({
  options: scale,
  series: [{ key: "Ventas", label: "Ventas", counts }],
});
const empty: Distribution = { options: scale, series: [] };

describe("DistributionChart", () => {
  it("shows the empty state (en)", () => {
    const data: DistributionData = {
      department: { manager: empty, current: empty },
      manager: { manager: empty, current: empty },
    };
    renderIn("en", <DistributionChart data={data} />);
    expect(screen.getByText("No ratings yet.")).toBeInTheDocument();
  });

  it("toggles pre (manager) vs post (current) (es)", async () => {
    const data: DistributionData = {
      department: { manager: dist([1, 0]), current: dist([0, 1]) },
      manager: { manager: dist([1, 0]), current: dist([0, 1]) },
    };
    renderIn("es", <DistributionChart data={data} />);
    expect(
      screen.getByRole("img", { name: "Ventas: Bajo 0, Alto 1" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Antes (manager)" }),
    );
    expect(
      screen.getByRole("img", { name: "Ventas: Bajo 1, Alto 0" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Antes (manager)" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("PublishCalibration", () => {
  it("asks for confirmation before publishing (en)", async () => {
    const publish = vi.fn().mockResolvedValue({ ok: true, count: 2 });
    renderIn(
      "en",
      <PublishCalibration cycleId="c" publishedAt={null} publish={publish} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Publish calibration" }),
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Publish the calibration?",
    );
    expect(publish).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(publish).toHaveBeenCalledWith("c"));
    expect(
      await screen.findByText("2 participants published"),
    ).toBeInTheDocument();
  });

  it("shows the publication date once published (es)", () => {
    renderIn(
      "es",
      <PublishCalibration
        cycleId="c"
        publishedAt={new Date("2026-03-01T12:00:00Z")}
        publish={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Publicada el");
  });
});
