import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CycleMemory } from "./cycle-memory";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

const remembered = () =>
  document.cookie
    .split("; ")
    .find((c) => c.startsWith("pr_cycle="))
    ?.split("=")[1];

describe("CycleMemory", () => {
  beforeEach(() => {
    document.cookie = "pr_cycle=; path=/; max-age=0";
  });

  it("remembers the cycle of the URL", () => {
    search = "cycle=abc-123&mode=both";
    render(<CycleMemory />);
    expect(remembered()).toBe("abc-123");
  });

  it("keeps what it remembered when the URL names no cycle", () => {
    search = "cycle=abc-123";
    const { rerender } = render(<CycleMemory />);
    search = "state=overdue";
    rerender(<CycleMemory />);
    expect(remembered()).toBe("abc-123");
  });

  it("does not take every-cycle or an empty value for a cycle", () => {
    search = "cycle=all";
    const { rerender } = render(<CycleMemory />);
    expect(remembered()).toBeUndefined();
    search = "cycle=";
    rerender(<CycleMemory />);
    expect(remembered()).toBeUndefined();
  });
});
