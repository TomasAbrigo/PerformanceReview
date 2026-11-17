import path from "node:path";
import { describe, expect, it } from "vitest";
import { findSensitiveFiles } from "@/lib/sensitive-data";
import {
  cycleSlug,
  defaultOutDir,
  parseExportArgs,
  reportFileNames,
} from "./cli";

describe("export:arturia arguments and paths", () => {
  it("parses the arguments", () => {
    expect(parseExportArgs(["--cycle", "latest"])).toEqual({
      cycle: "latest",
      anonymized: false,
      out: undefined,
    });
    expect(
      parseExportArgs(["--cycle", "x", "--anonymized", "--out", "/tmp/a"]),
    ).toEqual({ cycle: "x", anonymized: true, out: "/tmp/a" });
    expect(() => parseExportArgs([])).toThrow(/--cycle/);
    expect(() => parseExportArgs(["--cycle", "x", "--nope"])).toThrow();
  });

  it("writes under data/private by default, which the sensitive check never lets in", () => {
    const dir = defaultOutDir("Evaluación de desempeño 2024 (H1)");
    expect(dir).toBe(
      path.join("data/private/arturia", "evaluacion-de-desempeno-2024-h1"),
    );
    expect(cycleSlug("¡¡")).toBe("ciclo");
    const file = `${dir}/${reportFileNames(false).json}`;
    expect(findSensitiveFiles([{ path: file, content: "{}" }])).toEqual([
      { kind: "private-folder", path: file },
    ]);
    expect(reportFileNames(true)).toEqual({
      json: "report.anonymized.json",
      html: "report.anonymized.html",
    });
  });
});
