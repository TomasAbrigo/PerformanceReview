import { describe, expect, it } from "vitest";
import { goalTitleKey } from "./title-key";

describe("goalTitleKey", () => {
  it("ignores case, accents, repeated spaces and end punctuation", () => {
    expect(goalTitleKey("  Definir el PLAN de   carrera del área. ")).toBe(
      goalTitleKey("definir el plan de carrera del area"),
    );
  });
  it("keeps different words apart", () => {
    expect(goalTitleKey("Plan de carrera")).not.toBe(
      goalTitleKey("Plan de carreras"),
    );
  });
});
