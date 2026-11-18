import { describe, expect, it } from "vitest";
import { latestFirst, pickCycle } from "./current-cycle";

const cycles = [
  { id: "a", name: "A", periodStart: "2025-09-29", periodEnd: "2026-03-28" },
  { id: "b", name: "B", periodStart: "2026-03-29", periodEnd: "2026-09-28" },
  { id: "c", name: "C", periodStart: "2024-09-29", periodEnd: "2025-03-28" },
];

describe("latestFirst", () => {
  it("orders by the end of the period, latest first, without touching the input", () => {
    expect(latestFirst(cycles).map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(cycles.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a tie by name", () => {
    const tied = [
      {
        id: "z",
        name: "Z",
        periodStart: "2026-01-01",
        periodEnd: "2026-06-30",
      },
      {
        id: "y",
        name: "Y",
        periodStart: "2026-01-01",
        periodEnd: "2026-06-30",
      },
    ];
    expect(latestFirst(tied).map((c) => c.id)).toEqual(["y", "z"]);
  });
});

describe("pickCycle", () => {
  it("takes the cycle asked for in the URL first", () => {
    expect(pickCycle(cycles, "c", "b")?.id).toBe("c");
  });

  it("falls back to the remembered cycle when the URL names none or an unknown one", () => {
    expect(pickCycle(cycles, undefined, "c")?.id).toBe("c");
    expect(pickCycle(cycles, "nope", "c")?.id).toBe("c");
  });

  it("opens the first of the list when nothing is remembered or it is not in this list", () => {
    expect(pickCycle(cycles, undefined, undefined)?.id).toBe("a");
    expect(pickCycle(cycles, undefined, "gone")?.id).toBe("a");
    expect(pickCycle([], "a", "b")).toBeUndefined();
  });
});
