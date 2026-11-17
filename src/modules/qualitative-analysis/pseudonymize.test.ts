import { describe, expect, it } from "vitest";
import { depseudonymize, pseudonymize } from "./pseudonymize";

const sources = {
  knownNames: ["Adrián Bustos", "Silvana Molina"],
  emails: ["adrian.bustos@example.test"],
  employeeNumbers: ["E-1042"],
};

describe("pseudonymize", () => {
  it("replaces full names, first and last names (accent/case-insensitive), emails and legajos", () => {
    const { texts } = pseudonymize(
      [
        "Adrián Bustos ayuda mucho; adrian es clave y BUSTOS también.",
        "Escribile a adrian.bustos@example.test o a otra@corp.test",
        "Legajo 4471, ver también E-1042. Silvana coordina.",
      ],
      sources,
    );
    const all = texts.join(" ");
    expect(all).not.toMatch(/adri[aá]n|bustos|silvana|molina/i);
    expect(all).not.toMatch(/@/);
    expect(all).not.toMatch(/4471|1042/);
    expect(texts[0]).toBe("[P1] ayuda mucho; [P1] es clave y [P1] también.");
    expect(texts[1]).toBe("Escribile a [E1] o a [E2]");
    expect(texts[2]).toBe("[N1], ver también [N2]. [P2] coordina.");
  });

  it("does not touch words that only contain a name", () => {
    const { texts } = pseudonymize(["Ana es analítica"], {
      knownNames: ["Ana Ruiz"],
    });
    expect(texts[0]).toBe("[P1] es analítica");
  });

  it("tokens are stable per run and reversible", () => {
    const { texts, map } = pseudonymize(
      ["Silvana y Adrián", "Adrián otra vez"],
      sources,
    );
    expect(texts).toEqual(["[P1] y [P2]", "[P2] otra vez"]);
    expect(depseudonymize("habla con [P1] y [P2]", map)).toBe(
      "habla con Silvana Molina y Adrián Bustos",
    );
  });

  it("leaves name parts that are common words alone unless capitalised", () => {
    const { texts } = pseudonymize(
      [
        "Carla hizo un trabajo muy bueno su trabajo",
        "Bueno avisó tarde",
        "Luz y paz",
      ],
      { knownNames: ["Carla Bueno", "Luz Paz"] },
    );
    expect(texts).toEqual([
      "[P1] hizo un trabajo muy bueno su trabajo",
      "[P1] avisó tarde",
      "Luz y paz", // short common words never match alone
    ]);
  });
});
