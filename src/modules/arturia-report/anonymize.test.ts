import { describe, expect, it } from "vitest";
import { foldGroups, teamLabels } from "./anonymize";

describe("anonymization helpers", () => {
  const merge = (rest: { k: string; n: number }[]) => ({
    k: "Otros",
    n: rest.reduce((s, r) => s + r.n, 0),
  });
  it("folds small groups into Otros, or suppresses them when Otros is still small", () => {
    const groups = [
      { k: "a", n: 6 },
      { k: "b", n: 3 },
      { k: "c", n: 2 },
    ];
    expect(foldGroups(groups, 5, (g) => g.n, merge)).toEqual({
      shown: [{ k: "a", n: 6 }],
      others: { k: "Otros", n: 5 },
      suppressed: 0,
    });
    expect(foldGroups(groups, 6, (g) => g.n, merge)).toEqual({
      shown: [{ k: "a", n: 6 }],
      others: null,
      suppressed: 5,
    });
  });
  it("labels teams Equipo 1..N, stable regardless of order", () => {
    const a = teamLabels(["z", "a", "m", "a"]);
    expect([...a.values()]).toEqual(["Equipo 1", "Equipo 2", "Equipo 3"]);
    expect(a.get("a")).toBe("Equipo 1");
    expect(teamLabels(["m", "z", "a"])).toEqual(a);
  });
});
