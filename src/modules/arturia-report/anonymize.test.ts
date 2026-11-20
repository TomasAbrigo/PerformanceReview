import { describe, expect, it } from "vitest";
import { AliasBook, teamLabels } from "./anonymize";

describe("teamLabels", () => {
  it("labels teams 1..N, stable regardless of order", () => {
    const a = teamLabels(["z", "a", "m", "a"]);
    expect([...a.values()]).toEqual(["Equipo 1", "Equipo 2", "Equipo 3"]);
    expect(a.get("a")).toBe("Equipo 1");
    expect(teamLabels(["m", "z", "a"])).toEqual(a);
    expect(teamLabels(["x"], "Team").get("x")).toBe("Team 1");
  });
});

describe("AliasBook", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `id-${i}`);
  const base = teamLabels(ids);
  const numberOf = (label: string | undefined) => Number(label?.split(" ")[1]);

  it("without a salt gives the plain labels (the named report's order)", () => {
    const book = new AliasBook(base, null);
    expect(book.label("completion.byManager", "id-3")).toBe(base.get("id-3"));
  });

  it("is stable inside one scope and a permutation of 1..N", () => {
    const book = new AliasBook(base, "salt");
    const first = ids.map((id) => book.label("completion.byManager", id));
    expect(ids.map((id) => book.label("completion.byManager", id))).toEqual(
      first,
    );
    expect(first.map(numberOf).sort((a, b) => a - b)).toEqual(
      ids.map((_, i) => i + 1),
    );
    expect(first.every((l) => l?.startsWith("Equipo "))).toBe(true);
  });

  it("does not give a team the same alias in two cuts, so sizes cannot link them", () => {
    const book = new AliasBook(base, "salt");
    const a = ids.map((id) => book.label("completion.byManager", id));
    const b = ids.map((id) => book.label("goals.byManager", id));
    expect(b).not.toEqual(a);
  });

  it("changes with the salt (not stable between two reports) and ignores unknown keys", () => {
    const one = new AliasBook(base, "one");
    const two = new AliasBook(base, "two");
    expect(ids.map((id) => one.label("s", id))).not.toEqual(
      ids.map((id) => two.label("s", id)),
    );
    expect(one.label("s", "nobody")).toBeUndefined();
  });
});
