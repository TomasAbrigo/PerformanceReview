import { describe, expect, it } from "vitest";
import { cycleName } from "./cycle-name";

describe("cycleName", () => {
  it("uses the localized name when there is one", () => {
    const cycle = {
      name: "Evaluación semestral 2024-03-29 – 2024-09-28",
      localizedName: {
        es: "Evaluación semestral 2024-03-29 – 2024-09-28",
        en: "Semi-annual review 2024-03-29 – 2024-09-28",
      },
    };
    expect(cycleName(cycle, "en")).toBe(
      "Semi-annual review 2024-03-29 – 2024-09-28",
    );
    expect(cycleName({ name: "Ciclo 2024" }, "en")).toBe("Ciclo 2024");
  });
});
