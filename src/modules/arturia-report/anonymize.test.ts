import { describe, expect, it } from "vitest";
import { teamLabels } from "./anonymize";

describe("teamLabels", () => {
  it("labels teams 1..N, stable regardless of order", () => {
    const a = teamLabels(["z", "a", "m", "a"]);
    expect([...a.values()]).toEqual(["Equipo 1", "Equipo 2", "Equipo 3"]);
    expect(a.get("a")).toBe("Equipo 1");
    expect(teamLabels(["m", "z", "a"])).toEqual(a);
    expect(teamLabels(["x"], "Team").get("x")).toBe("Team 1");
  });
});
