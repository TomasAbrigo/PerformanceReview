import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("csv", () => {
  it("round-trips commas, quotes, newlines, accents and empty cells", () => {
    const header = ["Name", "Answer", "Note"];
    const rows = [
      ["María Pérez", 'Dijo "hola", y se fue', ""],
      ["Ñandú", "línea 1\nlínea 2", "ok"],
    ];
    const text = toCsv(header, rows);
    expect(parseCsv(text)).toEqual([header, ...rows]);
  });

  it("only quotes cells that need it and ends with a newline", () => {
    expect(toCsv(["a", "b"], [["x", "y,z"]])).toBe('a,b\nx,"y,z"\n');
  });
});
