import { describe, expect, it } from "vitest";
import { cycleName, storedCycleName } from "./cycle-name";

describe("cycleName", () => {
  it("uses the localized name when there is one", () => {
    const cycle = {
      name: "Evaluación semestral 2024-03-29 – 2024-09-28",
      localizedName: {
        es: "Evaluación semestral 2024-03-29 – 2024-09-28",
        en: "Semi-annual review 2024-03-29 – 2024-09-28",
      },
    };
    expect(cycleName(cycle, "en")).toBe("Semi-annual review Mar – Sep 2024");
    // Files keep the name as it is stored, days included.
    expect(storedCycleName(cycle, "en")).toBe(
      "Semi-annual review 2024-03-29 – 2024-09-28",
    );
    expect(cycleName({ name: "Ciclo 2024" }, "en")).toBe("Ciclo 2024");
  });
});

describe("cycleName dates", () => {
  const cycle = (start: string, end: string) => ({
    name: `Evaluación semestral ${start} – ${end}`,
    localizedName: {
      es: `Evaluación semestral ${start} – ${end}`,
      en: `Semi-annual review ${start} – ${end}`,
    },
  });

  it("writes a period of one year as its months and the year once", () => {
    expect(cycleName(cycle("2024-03-29", "2024-08-28"), "es")).toBe(
      "Evaluación semestral mar – ago 2024",
    );
    expect(cycleName(cycle("2024-03-29", "2024-08-28"), "en")).toBe(
      "Semi-annual review Mar – Aug 2024",
    );
  });

  it("keeps both years when the period crosses one", () => {
    expect(cycleName(cycle("2025-10-29", "2026-03-28"), "es")).toBe(
      "Evaluación semestral oct 2025 – mar 2026",
    );
  });

  it("leaves a name without a period of dates as it is", () => {
    expect(cycleName({ name: "Evaluación semestral 2026-H1" }, "es")).toBe(
      "Evaluación semestral 2026-H1",
    );
    expect(cycleName({ name: "Corte 2026-13-40 – 2026-14-41" }, "es")).toBe(
      "Corte 2026-13-40 – 2026-14-41",
    );
  });
});
