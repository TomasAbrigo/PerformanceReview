import { describe, expect, it } from "vitest";
import { generateCompany } from "../company";
import { parseCsv } from "./csv";
import { serializeOrgAttributes } from "./org-attributes";

describe("serializeOrgAttributes", () => {
  it.each([
    ["small", 1001],
    ["demo", 2002],
  ] as const)(
    "%s: no row ends before it starts (the importer rejects those) or starts before the person was hired",
    (size, seed) => {
      const company = generateCompany({ size, seed });
      const [file] = serializeOrgAttributes(company);
      const [, ...rows] = parseCsv(file.content);
      const hired = new Map(company.employees.map((e) => [e.id, e.hireDate]));
      expect(rows.length).toBeGreaterThan(0);
      for (const [eeid, , , , , , from, to] of rows) {
        if (to) expect(to >= from, `${eeid}: ${from} - ${to}`).toBe(true);
        expect(from >= hired.get(eeid)!, `${eeid} from ${from}`).toBe(true);
      }
    },
  );
});
