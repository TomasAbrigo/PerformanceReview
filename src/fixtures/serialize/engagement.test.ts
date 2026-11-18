import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUTOFFS,
  parseEngagementMonth,
  segmentOfScore,
} from "@/modules/engagement/kinds";
import { generateCompany } from "../company";
import { ENGAGEMENT_HEADER, serializeEngagement } from "./engagement";
import { parseCsv } from "./csv";

const fileOf = (size: "small" | "demo", seed: number) => {
  const company = generateCompany({ size, seed });
  const [file] = serializeEngagement(company);
  const [header, ...rows] = parseCsv(file.content);
  return { company, file, header, rows };
};

describe("serializeEngagement", () => {
  const { company, file, header, rows } = fileOf("small", 1001);

  it("writes engagement-monthly.csv with the file's header", () => {
    expect(file.path).toBe("engagement-monthly.csv");
    expect(header).toEqual([...ENGAGEMENT_HEADER]);
  });

  it("is deterministic from the seed", () => {
    expect(fileOf("small", 1001).file.content).toBe(file.content);
    expect(fileOf("small", 1002).file.content).not.toBe(file.content);
  });

  it("lists each person and month once, in the format the profile reads", () => {
    const keys = rows.map((r) => `${r[0]}|${r[2]}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.length).toBeGreaterThan(200);
    for (const [, , month] of rows) {
      expect(month).toMatch(/^\d{4}-\d{2}$/);
      expect(parseEngagementMonth(month)).not.toBeNull();
    }
  });

  it("has a score of 0-1 and the segment of the default cutoffs, or falta without score", () => {
    for (const [, , , score, segment] of rows) {
      if (segment === "Falta") {
        expect(score).toBe("");
      } else {
        const value = Number(score);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(segment.toLowerCase()).toBe(
          segmentOfScore(value, DEFAULT_CUTOFFS),
        );
      }
    }
    const segments = new Set(rows.map((r) => r[4]));
    expect([...segments].sort()).toEqual(
      ["Alto", "Bajo", "Falta", "Medio", "Regular"].sort(),
    );
  });

  it("only names people that exist, from their hire month to their termination or the end of the window", () => {
    const byId = new Map(company.employees.map((e) => [e.id, e]));
    for (const [eeid, , month] of rows) {
      const employee = byId.get(eeid);
      expect(employee, eeid).toBeDefined();
      expect(`${month}-01` >= `${employee!.hireDate.slice(0, 7)}-01`).toBe(
        true,
      );
      if (employee!.terminationDate) {
        expect(month <= employee!.terminationDate.slice(0, 7)).toBe(true);
      }
      expect(month < company.asOf.slice(0, 7)).toBe(true);
    }
  });

  it("the demo covers more months than the small one", () => {
    const months = (r: string[][]) => new Set(r.map((row) => row[2])).size;
    expect(months(fileOf("demo", 2002).rows)).toBeGreaterThan(months(rows));
  });
});
