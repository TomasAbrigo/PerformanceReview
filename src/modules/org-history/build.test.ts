import { describe, expect, it } from "vitest";
import { buildJobHistory, buildStatusHistory, type JobRow } from "./build";

const row = (
  over: Partial<JobRow> & Pick<JobRow, "sourceId" | "date">,
): JobRow => ({
  department: "Ventas",
  division: "LatAm",
  jobTitle: "Analista",
  location: "Córdoba",
  reportsTo: "Ana García",
  ...over,
});

describe("buildJobHistory", () => {
  it("chains valid_to to the next row's date and leaves the last row open", () => {
    const built = buildJobHistory(
      [
        row({ sourceId: "2", date: "2022-01-01", jobTitle: "Senior" }),
        row({ sourceId: "1", date: "2021-01-01" }),
      ],
      [],
    );
    expect(built.map((r) => [r.sourceId, r.validFrom, r.validTo])).toEqual([
      ["1", "2021-01-01", "2022-01-01"],
      ["2", "2022-01-01", null],
    ]);
    expect(built[0]).toMatchObject({
      jobTitle: "Analista",
      managerRaw: "Ana García",
    });
  });

  it("keeps only the last row (by id) of a same-day double change", () => {
    const built = buildJobHistory(
      [
        row({ sourceId: "1", date: "2021-01-01" }),
        row({ sourceId: "10", date: "2023-01-01", reportsTo: "Bruno" }),
        row({ sourceId: "2", date: "2023-01-01", jobTitle: "Lead" }),
      ],
      [],
    );
    expect(built).toHaveLength(2);
    expect(built[1]).toMatchObject({
      sourceId: "10",
      validFrom: "2023-01-01",
      validTo: null,
      managerRaw: "Bruno",
    });
  });

  it("collapses identical consecutive rows into the first one", () => {
    const built = buildJobHistory(
      [
        row({ sourceId: "1", date: "2021-01-01" }),
        row({ sourceId: "2", date: "2021-06-01" }),
        row({ sourceId: "3", date: "2022-01-01", location: "Remoto" }),
      ],
      [],
    );
    expect(built.map((r) => [r.sourceId, r.validFrom, r.validTo])).toEqual([
      ["1", "2021-01-01", "2022-01-01"],
      ["3", "2022-01-01", null],
    ]);
  });

  it("closes the open row the day after a termination", () => {
    const built = buildJobHistory(
      [row({ sourceId: "1", date: "2021-01-01" })],
      ["2024-06-30"],
    );
    expect(built[0].validTo).toBe("2024-07-01");
  });

  it("drops rows without a date and ignores terminations before a rehire", () => {
    const built = buildJobHistory(
      [
        row({ sourceId: "1", date: "2020-01-01" }),
        row({ sourceId: "9", date: null }),
        row({ sourceId: "2", date: "2025-01-01", jobTitle: "Rehire" }),
      ],
      ["2021-12-31"],
    );
    expect(built.map((r) => [r.validFrom, r.validTo])).toEqual([
      ["2020-01-01", "2022-01-01"],
      ["2025-01-01", null],
    ]);
  });
});

describe("buildStatusHistory", () => {
  it("chains status rows by date", () => {
    const built = buildStatusHistory([
      {
        sourceId: "2",
        date: "2024-06-30",
        status: "Terminated",
        comment: null,
      },
      { sourceId: "1", date: "2019-01-01", status: "Full-Time", comment: "x" },
    ]);
    expect(
      built.map((r) => [r.employmentStatus, r.validFrom, r.validTo]),
    ).toEqual([
      ["Full-Time", "2019-01-01", "2024-06-30"],
      ["Terminated", "2024-06-30", null],
    ]);
  });
});
