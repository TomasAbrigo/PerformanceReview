import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressRing } from "./experience";

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
