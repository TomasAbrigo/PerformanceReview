import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeltaPill, ProgressRing, ScaleBar } from "./experience";

describe("ProgressRing", () => {
  it.each([
    [42, 42],
    [-4, 0],
    [125, 100],
    [NaN, 0],
  ])("exposes a bounded accessible value for %s", (percent, expected) => {
    render(<ProgressRing percent={percent} label="Objetivos completados" />);
    expect(
      screen.getByRole("progressbar", { name: "Objetivos completados" }),
    ).toHaveAttribute("aria-valuenow", String(expected));
  });
  it("draws no completion mark for zero", () => {
    const { container } = render(<ProgressRing percent={0} label="Progreso" />);
    expect(container.querySelector(".ring-value")).toHaveAttribute(
      "opacity",
      "0",
    );
  });
});

describe("ScaleBar", () => {
  it("marks the target on the track and writes it between the ends", () => {
    const { container } = render(
      <ScaleBar
        value={62}
        min={0}
        max={100}
        label="Evaluaciones completas: 62 %"
        target={{ value: 80, label: "Meta 80 %" }}
      />,
    );
    const mark = container.querySelector(".scale-target");
    expect(mark).toHaveStyle({ left: "80%" });
    expect(screen.getByText("Meta 80 %")).toBeInTheDocument();
    // The meter still says the value, with the target in its name.
    expect(
      screen.getByRole("meter", {
        name: "Evaluaciones completas: 62 % · Meta 80 %",
      }),
    ).toHaveAttribute("aria-valuenow", "62");
  });

  it("draws no mark without a target or with one off the scale", () => {
    const { container, rerender } = render(
      <ScaleBar value={3} min={1} max={5} label="Retención: 3 de 5" />,
    );
    expect(container.querySelector(".scale-target")).toBeNull();
    rerender(
      <ScaleBar
        value={3}
        min={1}
        max={5}
        label="Retención: 3 de 5"
        target={{ value: 9, label: "Meta 9" }}
      />,
    );
    expect(container.querySelector(".scale-target")).toBeNull();
  });
});

describe("DeltaPill", () => {
  it("a flat change shows a dash, neither up nor down, and no colour", () => {
    render(<DeltaPill value={0} text="0,0 vs. ciclo anterior" />);
    const pill = screen.getByTestId("delta");
    expect(pill.querySelector("svg.lucide-minus")).not.toBeNull();
    expect(pill.className).not.toMatch(/delta-good|delta-bad/);
  });

  it("a rise points up and is good when up is better", () => {
    render(<DeltaPill value={2} text="+2 pts" />);
    const pill = screen.getByTestId("delta");
    expect(pill.querySelector("svg.lucide-arrow-up-right")).not.toBeNull();
    expect(pill.className).toMatch(/delta-good/);
  });
});
