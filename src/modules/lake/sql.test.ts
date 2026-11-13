// @vitest-environment node
import { describe, expect, it } from "vitest";
import { quote, sqlString } from "./sql";

describe("sql helpers", () => {
  it("quotes identifiers, doubling embedded quotes", () => {
    expect(quote("id")).toBe('"id"');
    expect(quote('Self: Feels "Valued"')).toBe('"Self: Feels ""Valued"""');
    expect(quote('x" OR 1=1 --')).toBe('"x"" OR 1=1 --"');
  });

  it("writes string literals, doubling embedded quotes", () => {
    expect(sqlString("/tmp/a.csv")).toBe("'/tmp/a.csv'");
    expect(sqlString("/tmp/o'brien.csv")).toBe("'/tmp/o''brien.csv'");
  });
});
